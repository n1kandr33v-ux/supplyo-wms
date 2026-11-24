from pathlib import Path
import subprocess,zipfile,os
root=Path(__file__).resolve().parent;tools=root.parent/'.android-tools';build=root/'build';build.mkdir(exist_ok=True)
jdk=next(tools.glob('jdk*/bin/javac.exe')).parent
sdk=next(tools.glob('platform/*/android.jar'));bt=next(tools.glob('build/*/aapt2.exe')).parent
res=root/'app/src/main/res';src=root/'app/src/main/java';env={**os.environ,'JAVA_HOME':str(jdk.parent),'PATH':str(jdk)+os.pathsep+os.environ['PATH']}
def run(*args):subprocess.run([str(a) for a in args],check=True,env=env)
run(bt/'aapt2.exe','compile','--dir',res,'-o',build/'resources.zip')
run(bt/'aapt2.exe','link','-o',build/'unsigned.apk','--manifest',root/'app/src/main/AndroidManifest.xml','-I',sdk,build/'resources.zip')
classes=build/'classes';classes.mkdir(exist_ok=True)
run(jdk/'javac.exe','-encoding','UTF-8','--release','8','-classpath',sdk,'-d',classes,*src.rglob('*.java'))
run(jdk/'jar.exe','cf',build/'classes.jar','-C',classes,'.')
dex=build/'dex';dex.mkdir(exist_ok=True)
run(jdk/'java.exe','-cp',bt/'lib/d8.jar','com.android.tools.r8.D8','--lib',sdk,'--min-api','26','--output',dex,build/'classes.jar')
with zipfile.ZipFile(build/'unsigned.apk','a',compression=zipfile.ZIP_DEFLATED) as z:z.write(dex/'classes.dex','classes.dex')
run(bt/'zipalign.exe','-f','4',build/'unsigned.apk',build/'aligned.apk')
key=root/'.signing/preview.p12';key.parent.mkdir(exist_ok=True)
if not key.exists():run(jdk/'keytool.exe','-genkeypair','-keystore',key,'-storepass','android','-keypass','android','-alias','androiddebugkey','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=supply preview,O=supply,C=RU')
output=build/'supply-android-0.3.0.apk'
run(jdk/'java.exe','-jar',bt/'lib/apksigner.jar','sign','--ks',key,'--ks-pass','pass:android','--ks-key-alias','androiddebugkey','--out',output,build/'aligned.apk')
run(jdk/'java.exe','-jar',bt/'lib/apksigner.jar','verify','--verbose',output)
run(bt/'aapt.exe','dump','badging',output)
print(output)
