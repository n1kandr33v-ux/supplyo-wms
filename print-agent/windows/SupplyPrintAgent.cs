using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Reflection;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Printing;
using System.Drawing.Drawing2D;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly:AssemblyTitle("supply Print Agent")]
[assembly:AssemblyProduct("supply Print Agent")]
[assembly:AssemblyVersion("1.0.0.0")]
[assembly:AssemblyFileVersion("1.1.0.0")]
namespace SupplyPrint {
 static class Program {
  public const string Version="2026.11.12-ozon-media";
  public static string Option(string[] args,string key,string fallback){for(int i=0;i<args.Length-1;i++)if(args[i]==key)return args[i+1];return fallback;}
  [STAThread] static int Main(string[] args){
   Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
   try {
    int port=int.Parse(Option(args,"--port","17891"));if(port<1024||port>65535)throw new Exception("Некорректный порт.");
    string state=Option(args,"--state-dir",Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ZakypitPrintAgent"));
    bool first;using(var mutex=new Mutex(true,"Local\\SupplyPrintAgent-"+port,out first)){
     if(!first)return 0;
     try{using(var app=new AgentContext(port,state,Array.IndexOf(args,"--no-tray")<0,Option(args,"--stop-file","")))Application.Run(app);}finally{mutex.ReleaseMutex();}
    }
    return 0;
   }catch(Exception e){MessageBox.Show("Не удалось запустить агент supply. Возможно, он уже работает.\n\n"+e.Message,"supply — печать",MessageBoxButtons.OK,MessageBoxIcon.Information);return 1;}
  }
 }
 sealed class AgentContext:ApplicationContext {
  readonly HttpListener listener=new HttpListener();
  readonly JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=67108864};
  readonly object lifecycle=new object(),printGate=new object();
  readonly string root,stopFile,deviceId;readonly int port;readonly Control dispatch=new Control();
  readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
  readonly HashSet<string> origins=new HashSet<string>(StringComparer.OrdinalIgnoreCase){"https://77-87-212-236.sslip.io","http://127.0.0.1:8093","http://127.0.0.1:8095","http://localhost:8093","http://localhost:8095","http://127.0.0.1:3040","http://localhost:3040"};
  NotifyIcon icon;ToolStripMenuItem status;string printer="";int active;bool stopping;
  public AgentContext(int port,string root,bool tray,string stopFile){
   this.port=port;this.root=Path.GetFullPath(root);this.stopFile=stopFile;Directory.CreateDirectory(this.root);var handle=dispatch.Handle;
   string devicePath=Path.Combine(this.root,"device-id.txt");Guid device;if(!File.Exists(devicePath)||!Guid.TryParse(File.ReadAllText(devicePath).Trim(),out device)){device=Guid.NewGuid();File.WriteAllText(devicePath,device.ToString());}deviceId=device.ToString();
   string config=Path.Combine(this.root,"config.json");
   if(File.Exists(config)){try{var data=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(config,Encoding.UTF8));if(data.ContainsKey("printer"))printer=Convert.ToString(data["printer"]);}catch{}}
   if(String.IsNullOrEmpty(printer))printer=new PrinterSettings().PrinterName;
   listener.Prefixes.Add("http://127.0.0.1:"+port+"/");listener.Start();
   if(tray){var menu=new ContextMenuStrip();status=new ToolStripMenuItem("Агент готов к печати"){Enabled=false};menu.Items.Add(status);menu.Items.Add("Открыть supply",null,(s,e)=>Process.Start("https://77-87-212-236.sslip.io/#app"));menu.Items.Add("Открыть журнал",null,(s,e)=>Process.Start("notepad.exe","\""+Path.Combine(this.root,"agent.log")+"\""));menu.Items.Add(new ToolStripSeparator());menu.Items.Add("Выход",null,(s,e)=>Stop());icon=new NotifyIcon{Text="supply — агент готов",Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath),Visible=true,ContextMenuStrip=menu,BalloonTipTitle="Печать supply готова",BalloonTipText="Вернитесь на сайт и выберите принтер."};icon.ShowBalloonTip(3500);}
   Log("Started version="+Program.Version+" port="+port);
   new Thread(Accept){IsBackground=true,Name="supply print listener"}.Start();
   timer.Interval=250;timer.Tick+=(s,e)=>{if(!String.IsNullOrEmpty(stopFile)&&File.Exists(stopFile))Stop();};timer.Start();
  }
  void Log(string text){lock(json){File.AppendAllText(Path.Combine(root,"agent.log"),DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")+" "+text+Environment.NewLine,Encoding.UTF8);}}
  void Accept(){try{while(listener.IsListening){HttpListenerContext c=listener.GetContext();ThreadPool.QueueUserWorkItem(_=>Handle(c));}}catch(HttpListenerException){}catch(ObjectDisposedException){}finally{if(!dispatch.IsDisposed)dispatch.BeginInvoke((Action)(()=>ExitThread()));}}
  void Stop(){lock(lifecycle){if(stopping)return;stopping=true;if(status!=null)status.Text="Завершаем принятые задания…";if(active==0)listener.Stop();}}
  void Headers(HttpListenerContext c){string origin=c.Request.Headers["Origin"];if(!String.IsNullOrEmpty(origin)&&origins.Contains(origin)){c.Response.Headers["Access-Control-Allow-Origin"]=origin;c.Response.Headers["Vary"]="Origin";}c.Response.Headers["Access-Control-Allow-Methods"]="GET, POST, OPTIONS";c.Response.Headers["Access-Control-Allow-Headers"]="Content-Type, X-WMS-Print-Agent";c.Response.Headers["Access-Control-Allow-Private-Network"]="true";c.Response.Headers["Cache-Control"]="no-store";}
  void Reply(HttpListenerContext c,int code,object value){Headers(c);c.Response.StatusCode=code;c.Response.ContentType="application/json; charset=utf-8";string text;lock(json)text=json.Serialize(value);byte[] bytes=Encoding.UTF8.GetBytes(text);c.Response.ContentLength64=bytes.Length;c.Response.OutputStream.Write(bytes,0,bytes.Length);c.Response.Close();}
  object[] Printers(){var list=new List<object>();string preferred=new PrinterSettings().PrinterName;foreach(string name in PrinterSettings.InstalledPrinters)list.Add(new{name=name,@default=name==preferred});return list.ToArray();}
  void Handle(HttpListenerContext c){bool counted=false;try{
   string origin=c.Request.Headers["Origin"],path=c.Request.Url.AbsolutePath;
   if(!String.IsNullOrEmpty(origin)&&!origins.Contains(origin)){Reply(c,403,new{ok=false,error="Источник запроса не разрешён."});return;}
   if(c.Request.HttpMethod=="OPTIONS"){Headers(c);c.Response.StatusCode=204;c.Response.Close();return;}
   if(c.Request.HttpMethod=="GET"&&(path=="/health"||path=="/printers")){
    if(path=="/health"&&c.Request.QueryString["quick"]=="1")Reply(c,200,new{ok=true,printer=printer,port=port,version=Program.Version,batch=true,maxBatch=1000,mediaSizes=true,deviceId=deviceId});
    else Reply(c,200,new{ok=true,printer=printer,port=port,version=Program.Version,batch=true,maxBatch=1000,mediaSizes=true,deviceId=deviceId,defaultPrinter=new PrinterSettings().PrinterName,printers=Printers()});return;
   }
   if(c.Request.HttpMethod!="POST"||(path!="/print"&&path!="/print-batch")){Reply(c,404,new{ok=false,error="Not found"});return;}
   if(c.Request.Headers["X-WMS-Print-Agent"]!="Supplyo"){Reply(c,403,new{ok=false,error="Отсутствует заголовок печатного клиента."});return;}
   if(c.Request.ContentLength64<0||c.Request.ContentLength64>67108864)throw new Exception("Слишком большое задание печати.");
   lock(lifecycle){if(stopping){Reply(c,503,new{ok=false,error="Агент завершает работу. Повторите позже."});return;}active++;counted=true;}
   string body;using(var reader=new StreamReader(c.Request.InputStream,Encoding.UTF8))body=reader.ReadToEnd();
   Dictionary<string,object> data;lock(json)data=json.Deserialize<Dictionary<string,object>>(body);
   if(data.ContainsKey("device_id")&&Convert.ToString(data["device_id"])!=deviceId)throw new Exception("Задание предназначено для другого агента печати.");
   string target=data.ContainsKey("printer")?Convert.ToString(data["printer"]):printer;
   lock(printGate){
    if(path=="/print-batch"){
     string id=data.ContainsKey("job_id")?Convert.ToString(data["job_id"]):"";
     if(!System.Text.RegularExpressions.Regex.IsMatch(id,"^[a-zA-Z0-9-]{16,80}$"))throw new Exception("Invalid job ID.");
     var images=new List<string>();var sizes=new List<SizeF>();if(!data.ContainsKey("stickers"))throw new Exception("Нет этикеток.");foreach(object entry in (IEnumerable)data["stickers"]){var item=(Dictionary<string,object>)entry;images.Add(ImageBase64(item));sizes.Add(MediaSize(item));}
     if(images.Count<1||images.Count>1000)throw new Exception("Ожидается от 1 до 1000 этикеток.");
     string digest;using(var sha=SHA256.Create())digest=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(body))).Replace("-","");
     string jobs=Path.Combine(root,"jobs");Directory.CreateDirectory(jobs);string job=Path.Combine(jobs,id+".json");
     if(File.Exists(job)){
      Dictionary<string,object> previous;lock(json)previous=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(job,Encoding.UTF8));
      if(Convert.ToString(previous["digest"])!=digest)throw new Exception("Job ID was already used with different labels.");
      if(Convert.ToString(previous["status"])=="completed")Reply(c,200,new{ok=true,printer=target,count=images.Count,duplicate=true});
      else Reply(c,409,new{ok=false,error="Результат печати не определён. Проверьте принтер перед новым заданием."});return;
     }
     SaveJob(job,digest,"started",images.Count);Print(images,target,sizes);SaveJob(job,digest,"completed",images.Count);Reply(c,200,new{ok=true,printer=target,count=images.Count});
    }else{Print(new List<string>{ImageBase64(data)},target);Reply(c,200,new{ok=true,printer=target});}
   }
  }catch(Exception e){try{Log("ERROR "+e.Message);Reply(c,500,new{ok=false,error=e.Message});}catch{}}
   finally{if(counted)lock(lifecycle){active--;if(stopping&&active==0)listener.Stop();}}
  }
  void SaveJob(string path,string digest,string state,int count){string text;lock(json)text=json.Serialize(new{digest=digest,status=state,count=count});File.WriteAllText(path,text,new UTF8Encoding(true));}
  string ImageBase64(Dictionary<string,object> item){foreach(string key in new[]{"file","png","image","content","base64"})if(item.ContainsKey(key)&&!String.IsNullOrWhiteSpace(Convert.ToString(item[key])))return Convert.ToString(item[key]);if(item.ContainsKey("sticker"))return ImageBase64((Dictionary<string,object>)item["sticker"]);throw new Exception("Этикетка отсутствует.");}
  SizeF MediaSize(Dictionary<string,object> item){
   bool w=item.ContainsKey("width_mm"),h=item.ContainsKey("height_mm");if(w!=h)throw new Exception("Укажите обе стороны этикетки.");if(!w)return new SizeF(58,40);
   double width=Convert.ToDouble(item["width_mm"]),height=Convert.ToDouble(item["height_mm"]);if(Double.IsNaN(width)||Double.IsNaN(height)||Double.IsInfinity(width)||Double.IsInfinity(height)||width<20||height<20||width>220||height>220)throw new Exception("Неподдерживаемый размер этикетки.");return new SizeF((float)width,(float)height);
  }
  void Print(List<string> encoded,string target,List<SizeF> sizes=null){
   var images=new List<Image>();var streams=new List<MemoryStream>();
   try{
    foreach(string source in encoded){string value=System.Text.RegularExpressions.Regex.Replace(source,"^data:image/[^;]+;base64,","");value=System.Text.RegularExpressions.Regex.Replace(value,@"\s+","");if(value.Length==0||value.Length>4194304)throw new Exception("Invalid sticker image size.");var stream=new MemoryStream(Convert.FromBase64String(value));streams.Add(stream);var image=Image.FromStream(stream);images.Add(image);if(image.Width>3000||image.Height>3000)throw new Exception("Sticker resolution too large.");}
    using(var document=new PrintDocument()){
     document.PrintController=new StandardPrintController();if(!String.IsNullOrWhiteSpace(target))document.PrinterSettings.PrinterName=target;if(!document.PrinterSettings.IsValid)throw new Exception("Printer not found: "+target);
     document.DocumentName="supply labels ("+images.Count+")";document.DefaultPageSettings.Margins=new Margins(0,0,0,0);document.OriginAtMargins=false;int index=0;
     Func<int,PaperSize> paper=i=>{SizeF size=sizes==null?new SizeF(58,40):sizes[i];return new PaperSize("supply label",(int)Math.Round(size.Width/25.4*100),(int)Math.Round(size.Height/25.4*100));};
     document.DefaultPageSettings.PaperSize=paper(0);document.DefaultPageSettings.Landscape=false;
     document.QueryPageSettings+=(s,e)=>{e.PageSettings.PaperSize=paper(index);e.PageSettings.Margins=new Margins(0,0,0,0);e.PageSettings.Landscape=false;};
     document.PrintPage+=(s,e)=>{e.Graphics.PageUnit=GraphicsUnit.Display;e.Graphics.InterpolationMode=InterpolationMode.NearestNeighbor;e.Graphics.PixelOffsetMode=PixelOffsetMode.Half;e.Graphics.DrawImage(images[index],new RectangleF(0,0,e.PageBounds.Width,e.PageBounds.Height));index++;e.HasMorePages=index<images.Count;};
     document.Print();Log("Spool accepted count="+images.Count);
    }
   }finally{foreach(var im in images)im.Dispose();foreach(var stream in streams)stream.Dispose();}
  }
  protected override void ExitThreadCore(){timer.Dispose();listener.Close();if(icon!=null){icon.Visible=false;icon.Dispose();}Log("Stopped after accepted requests completed");dispatch.Dispose();base.ExitThreadCore();}
 }
}
