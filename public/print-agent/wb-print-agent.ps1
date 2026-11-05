param(
    [string]$PrinterName = "",
    [int]$Port = 17891,
    [int]$WidthMm = 58,
    [int]$HeightMm = 40
)

$ErrorActionPreference = "Stop"
$root = Join-Path $env:LOCALAPPDATA "ZakypitPrintAgent"
$logPath = Join-Path $root "agent.log"
New-Item -ItemType Directory -Force -Path $root | Out-Null
Add-Type -AssemblyName System.Drawing
$localConfig = Join-Path $root "config.json"
$sourceConfig = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "config.json"

if ($PrinterName.Trim() -eq "") {
    foreach ($configPath in @($sourceConfig, $localConfig)) {
        if ($PrinterName.Trim() -ne "" -or -not (Test-Path -LiteralPath $configPath)) {
            continue
        }
        try {
            $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($config.PSObject.Properties.Name -contains "printer" -and [string]$config.printer -ne "") {
                $PrinterName = [string]$config.printer
            }
            if ($config.PSObject.Properties.Name -contains "port" -and [int]$config.port -gt 0) {
                $Port = [int]$config.port
            }
        }
        catch {
        }
    }
}

if ($PrinterName.Trim() -eq "") {
    $PrinterName = "Xprinter XP-365B"
}

function Write-AgentLog {
    param([string]$Message)
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Add-CorsHeaders {
    param($Response)
    $Response.Headers["Access-Control-Allow-Origin"] = "*"
    $Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    $Response.Headers["Access-Control-Allow-Headers"] = "Content-Type, X-WMS-Print-Agent"
    $Response.Headers["Access-Control-Allow-Private-Network"] = "true"
    $Response.Headers["Cache-Control"] = "no-store"
}

function Send-Json {
    param($Response, [int]$StatusCode, $Payload)
    Add-CorsHeaders $Response
    $Response.StatusCode = $StatusCode
    $Response.ContentType = "application/json; charset=utf-8"
    $json = $Payload | ConvertTo-Json -Depth 8 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.Close()
}

function Get-StickerBase64 {
    param($Payload)
    foreach ($name in @("file", "png", "image", "content", "base64")) {
        if ($Payload.PSObject.Properties.Name -contains $name) {
            $value = [string]$Payload.$name
            if ($value.Trim() -ne "") {
                return $value
            }
        }
    }
    if ($Payload.PSObject.Properties.Name -contains "sticker" -and $null -ne $Payload.sticker) {
        return Get-StickerBase64 $Payload.sticker
    }
    return ""
}

function Get-PrinterList {
    $items = @()
    try {
        $items = @(Get-CimInstance -ClassName Win32_Printer |
            Sort-Object Name |
            ForEach-Object {
                @{ name = [string]$_.Name; default = [bool]$_.Default }
            })
    }
    catch {
        Write-AgentLog "Printer list CIM error: $($_.Exception.Message)"
    }

    if ($items.Count -eq 0) {
        try {
            Add-Type -AssemblyName System.Drawing
            $items = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters |
                ForEach-Object {
                    @{ name = [string]$_; default = $false }
                })
        }
        catch {
            Write-AgentLog "Printer list fallback error: $($_.Exception.Message)"
        }
    }

    return $items
}

function Print-StickerPng {
    param([string]$Base64, [string]$TargetPrinter)
    Print-StickerBatch -Base64s @($Base64) -TargetPrinter $TargetPrinter
}

function Print-StickerBatch {
    param([string[]]$Base64s, [string]$TargetPrinter)

    $prepareWatch = [System.Diagnostics.Stopwatch]::StartNew()
    $doc = $null
    $images = New-Object System.Collections.ArrayList
    $streams = New-Object System.Collections.ArrayList
    $cursor = @{ Index = 0 }
    if ($Base64s.Count -lt 1 -or $Base64s.Count -gt 1000) { throw "Expected 1 to 1000 labels." }
    try {
        # Decode the entire job before submitting any page to Windows.
        foreach ($Base64 in $Base64s) {
            $clean = ($Base64 -replace "^data:image/[^;]+;base64,", "") -replace "\s+", ""
            if ($clean -eq "" -or $clean.Length -gt 4194304) { throw "Invalid sticker image size." }
            $bytes = [Convert]::FromBase64String($clean)
            $stream = New-Object System.IO.MemoryStream(,$bytes)
            [void]$streams.Add($stream)
            $image = [System.Drawing.Image]::FromStream($stream)
            [void]$images.Add($image)
            if ($image.Width -gt 3000 -or $image.Height -gt 3000) { throw "Sticker resolution too large." }
        }
        $doc = New-Object System.Drawing.Printing.PrintDocument
        $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
        if ($TargetPrinter.Trim() -ne "") {
            $doc.PrinterSettings.PrinterName = $TargetPrinter
        }
        if (-not $doc.PrinterSettings.IsValid) {
            throw "Printer not found: $TargetPrinter"
        }

        $paperWidth = [int][Math]::Round($WidthMm / 25.4 * 100)
        $paperHeight = [int][Math]::Round($HeightMm / 25.4 * 100)
        $paper = New-Object System.Drawing.Printing.PaperSize("WB Sticker ${WidthMm}x${HeightMm}mm", $paperWidth, $paperHeight)
        $doc.DefaultPageSettings.PaperSize = $paper
        $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
        $doc.OriginAtMargins = $false
        $doc.DocumentName = "WMS labels ($($images.Count))"

        $handler = [System.Drawing.Printing.PrintPageEventHandler]{
            param($sender, $event)
            $event.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Display
            $event.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
            $event.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
            $bounds = $event.PageBounds
            $rect = New-Object System.Drawing.RectangleF(0, 0, [single]$bounds.Width, [single]$bounds.Height)
            $event.Graphics.DrawImage($images[$cursor.Index], $rect)
            $cursor.Index++
            $event.HasMorePages = $cursor.Index -lt $images.Count
        }
        $doc.add_PrintPage($handler)
        $prepareWatch.Stop()
        $spoolWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $doc.Print()
        $spoolWatch.Stop()
        $doc.remove_PrintPage($handler)
        Write-AgentLog "Print timing labels=$($images.Count) prepare_ms=$($prepareWatch.ElapsedMilliseconds) spool_ms=$($spoolWatch.ElapsedMilliseconds)"
    }
    finally {
        if ($doc) { $doc.Dispose() }
        foreach ($image in $images) { $image.Dispose() }
        foreach ($stream in $streams) { $stream.Dispose() }
    }
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://127.0.0.1:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-AgentLog "Started on $prefix printer='$PrinterName'"

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    try {
        if ($request.HttpMethod -eq "OPTIONS") {
            Add-CorsHeaders $response
            $response.StatusCode = 204
            $response.Close()
            continue
        }

        if ($request.HttpMethod -eq "GET" -and $request.Url.AbsolutePath -eq "/health" -and $request.QueryString["quick"] -eq "1") {
            Send-Json $response 200 @{ ok = $true; printer = $PrinterName; port = $Port; version = "2026.10.19-batch"; batch = $true; maxBatch = 1000 }
            continue
        }

        if ($request.HttpMethod -eq "GET" -and ($request.Url.AbsolutePath -eq "/health" -or $request.Url.AbsolutePath -eq "/printers")) {
            $printers = @(Get-PrinterList)
            $defaultPrinter = ""
            foreach ($printer in $printers) {
                if ($printer.default) {
                    $defaultPrinter = $printer.name
                    break
                }
            }
            Send-Json $response 200 @{ ok = $true; printer = $PrinterName; defaultPrinter = $defaultPrinter; printers = $printers; port = $Port; version = "2026.10.19-batch"; batch = $true; maxBatch = 1000 }
            continue
        }

        if ($request.HttpMethod -ne "POST" -or $request.Url.AbsolutePath -notin @("/print", "/print-batch")) {
            Send-Json $response 404 @{ ok = $false; error = "Not found" }
            continue
        }

        if ($request.ContentLength64 -lt 0 -or $request.ContentLength64 -gt 67108864) { throw "Print request too large." }
        $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
        $body = $reader.ReadToEnd()
        $reader.Close()
        $payload = $body | ConvertFrom-Json
        $targetPrinter = if ($payload.PSObject.Properties.Name -contains "printer" -and [string]$payload.printer -ne "") { [string]$payload.printer } else { $PrinterName }
        if ($request.Url.AbsolutePath -eq "/print-batch") {
            $jobId = [string]$payload.job_id
            if ($jobId -notmatch '^[a-zA-Z0-9-]{16,80}$') { throw "Invalid job ID." }
            $files = @($payload.stickers | ForEach-Object { Get-StickerBase64 $_ })
            if ($files.Count -lt 1 -or $files.Count -gt 1000) { throw "Expected 1 to 1000 labels." }
            $hasher = [System.Security.Cryptography.SHA256]::Create()
            try { $digest = [BitConverter]::ToString($hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($body))).Replace('-', '') }
            finally { $hasher.Dispose() }
            $jobsDir = Join-Path $root 'jobs'
            New-Item -ItemType Directory -Force -Path $jobsDir | Out-Null
            $jobPath = Join-Path $jobsDir ($jobId + '.json')
            if (Test-Path -LiteralPath $jobPath) {
                $previous = Get-Content -LiteralPath $jobPath -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($previous.digest -ne $digest) { throw "Job ID was already used with different labels." }
                if ($previous.status -eq 'completed') {
                    Send-Json $response 200 @{ ok = $true; printer = $targetPrinter; count = $files.Count; duplicate = $true }
                } else {
                    Send-Json $response 409 @{ ok = $false; error = 'Print result uncertain. Check the printer before starting another job.' }
                }
                continue
            }
            @{ digest = $digest; status = 'started'; count = $files.Count } | ConvertTo-Json | Set-Content -LiteralPath $jobPath -Encoding UTF8
            Print-StickerBatch -Base64s $files -TargetPrinter $targetPrinter
            @{ digest = $digest; status = 'completed'; count = $files.Count } | ConvertTo-Json | Set-Content -LiteralPath $jobPath -Encoding UTF8
            Send-Json $response 200 @{ ok = $true; printer = $targetPrinter; count = $files.Count }
            continue
        }
        $base64 = Get-StickerBase64 $payload
        Print-StickerPng -Base64 $base64 -TargetPrinter $targetPrinter
        Write-AgentLog "Printed sticker on '$targetPrinter'"
        Send-Json $response 200 @{ ok = $true; printer = $targetPrinter }
    }
    catch {
        Write-AgentLog "ERROR $($_.Exception.Message)"
        Send-Json $response 500 @{ ok = $false; error = $_.Exception.Message }
    }
}
