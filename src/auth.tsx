import {formatFullName,fullNameError,emailError,formatPhone,phoneError} from './auth-fields';
import { useState } from "react";
import {AuthCode,AuthError,authRequest} from './auth-code';
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import "./auth.css";
export function Auth({
  register = false,
  live = false,
  onAuthenticated,
}: {
  register?: boolean;
  live?: boolean;
  onAuthenticated?: () => Promise<void>;
}) {
  const [challenge,setChallenge]=useState<{id?:string;retryAfter?:number;request:Record<string,unknown>}|null>(null);
  const [existing,setExisting]=useState(false);
  const [touched,setTouched]=useState<Record<string,boolean>>({});
  const [busy, setBusy] = useState(false),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [repeatPassword, setRepeatPassword] = useState(""),
    [repeatVisible, setRepeatVisible] = useState(false),
    [password, setPassword] = useState(""),
    [visible, setVisible] = useState(false),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false);
  const fieldErrors={name:register?fullNameError(name):'',email:emailError(email),phone:register?phoneError(phone):''};
  function mark(field:string){setTouched(previous=>({...previous,[field]:true}))}
  function warning(field:keyof typeof fieldErrors){return touched[field]&&fieldErrors[field]?<p className="auth-field-error" id={'auth-'+field+'-error'} role="alert">{fieldErrors[field]}</p>:null}

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setTouched({name:true,email:true,phone:true});
    const invalid=Object.entries(fieldErrors).find(([,message])=>message);
    if(invalid){setError('Исправьте выделенные поля.');document.getElementById('auth-'+invalid[0])?.focus();return}
    if (!register && !password) {
      setError("Введите пароль");
      return;
    }
    if (register && (password.length < 8||password.length>128)) {
      setError("Пароль должен содержать от 8 до 128 символов");
      return;
    }
    if (register && password !== repeatPassword) {
      setError("Пароли не совпадают");
      return;
    }
    if (register && !consent) {
      setError("Подтвердите ознакомление с условиями");
      return;
    }
    if (live) {
      setBusy(true);
      setError("");setExisting(false);
      try {
        if(register){const request={email:email.trim(),password,name:formatFullName(name.trim()),phone,consent,purpose:'register'};const data=await authRequest('code/request',request);setChallenge({id:data.id,retryAfter:data.retryAfter,request});return;}
        await authRequest('login',{email:email.trim(),password});
        await onAuthenticated?.();
        window.location.hash = "app";
      } catch (e) {
        setError((e as Error).message || "Нет связи с сервером");
        setExisting(e instanceof AuthError&&e.status===409);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!register) {
      setBusy(true);
      await new Promise((resolve) => setTimeout(resolve, 500));
      sessionStorage.setItem("supplyo-demo-email", email.trim().toLowerCase());
      window.location.hash =
        email.trim().toLowerCase() === "eleg1dowork@gmail.com"
          ? "account"
          : "wms";
      return;
    }
    setError(
      "Это предварительный просмотр. Регистрация станет доступна после подключения сервера авторизации.",
    );
  }
  return (
    <main className="auth-page dark">
      <a className="auth-brand" href="#welcome">
        <img src={`${import.meta.env.BASE_URL}brand-logo.png?v=20261110-2`} alt="supply" />
      </a>
      <div className="auth-layout">
        <section className="auth-story">
          <span>ВМС ДЛЯ ФУЛФИЛМЕНТОВ</span>
          <h1>
            Всё готово
            <br />к рабочему дню.
          </h1>
          <p>
            Заказы клиентов, сборка и остатки.
            <br />В одном пространстве для вашей команды.
          </p>
          <div className="auth-story-line" />
          <small>От первого скана до передачи в доставку.</small>
        </section>
        {challenge?<AuthCode request={challenge.request} initial={challenge.id?{id:challenge.id,retryAfter:challenge.retryAfter}:undefined} onBack={()=>setChallenge(null)} onDone={async()=>{await onAuthenticated?.();window.location.hash='app'}}/>:<section className="auth-panel">
          <div className="auth-switch">
            <a className={!register ? "selected" : ""} href="#login">
              Вход
            </a>
            <a className={register ? "selected" : ""} href="#register">
              Регистрация
            </a>
          </div>
          <h2>{register ? "Создайте аккаунт" : "С возвращением"}</h2>
          <p className="auth-subtitle">
            {register
              ? "Начните с профиля, затем добавьте склад и клиентов."
              : "Войдите в рабочее пространство supply."}
          </p>
          <form noValidate onSubmit={submit} onChange={() => {setError("");setExisting(false)}}>
            {register && (
              <Field>
                <FieldLabel htmlFor="auth-name">ФИО</FieldLabel>
                <Input
                  id="auth-name"
                  autoComplete="name"
                  placeholder="Фамилия Имя Отчество"
                  value={name}
                  onChange={(e) => setName(formatFullName(e.target.value))}
                  maxLength={150}
                  onBlur={()=>{setName(formatFullName(name.trim()));mark("name")}}
                  aria-invalid={!!(touched.name&&fieldErrors.name)}
                  aria-describedby={touched.name&&fieldErrors.name?"auth-name-error":undefined}
                />
                {warning("name")}
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="auth-email">Электронная почта</FieldLabel>
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                maxLength={254}
                onChange={(e) => setEmail(e.target.value.trim())}
                onBlur={()=>mark('email')}
                aria-invalid={!!(touched.email&&fieldErrors.email)}
                aria-describedby={touched.email&&fieldErrors.email?'auth-email-error':undefined}
              />
              {warning("email")}
            </Field>
            {register && (
              <Field>
                <FieldLabel htmlFor="auth-phone">Номер телефона</FieldLabel>
                <Input
                  id="auth-phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="+7 (999) 123-45-67"
                  value={phone}
                  maxLength={18}
                  onPaste={e=>{e.preventDefault();setPhone(formatPhone(e.clipboardData.getData('text')))}}
                  onChange={(e) => {
                    const input=e.target,position=input.selectionStart??input.value.length;
                    const digitCount=input.value.slice(0,position).replace(/\D/g,'').length;
                    const formatted=formatPhone(input.value);setPhone(formatted);
                    requestAnimationFrame(()=>{let seen=0,caret=formatted.length;for(let i=0;i<formatted.length;i++)if(/\d/.test(formatted[i])&&++seen===digitCount){caret=i+1;break}input.setSelectionRange(caret,caret)});
                  }}
                  onKeyDown={e=>{
                    const input=e.currentTarget,position=input.selectionStart??0;
                    if(e.key==='Backspace'&&input.selectionStart===input.selectionEnd&&position>0&&!/\d/.test(phone[position-1]??'')){
                      e.preventDefault();let index=position-1;while(index>1&&!/\d/.test(phone[index]))index--;
                      if(index>1){setPhone(formatPhone(phone.slice(0,index)+phone.slice(index+1)));requestAnimationFrame(()=>input.setSelectionRange(index,index))}
                    }
                  }}
                  onBlur={()=>mark('phone')}
                  aria-invalid={!!(touched.phone&&fieldErrors.phone)}
                  aria-describedby={touched.phone&&fieldErrors.phone?'auth-phone-error':undefined}
                />
                {warning("phone")}
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="auth-password">Пароль</FieldLabel>
              <div className="auth-password">
                <Input
                  id="auth-password"
                  type={visible ? "text" : "password"}
                  autoComplete={register ? "new-password" : "current-password"}
                  placeholder={
                    register ? "Не менее 8 символов" : "Введите пароль"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </Field>
            {register && (
              <Field>
                <FieldLabel htmlFor="auth-password-repeat">
                  Подтверждение пароля
                </FieldLabel>
                <div className="auth-password">
                  <Input
                    id="auth-password-repeat"
                    type={repeatVisible ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Введите пароль ещё раз"
                    value={repeatPassword}
                    onChange={(e) => setRepeatPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setRepeatVisible(!repeatVisible)}
                    aria-label={
                      repeatVisible
                        ? "Скрыть повтор пароля"
                        : "Показать повтор пароля"
                    }
                  >
                    {repeatVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </Field>
            )}
            {register && (
              <label className="auth-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  Я ознакомлен с условиями использования и политикой обработки
                  персональных данных.
                  <small>
                    Документы будут доступны перед запуском регистрации.
                  </small>
                </span>
              </label>
            )}
            {error && (
              <p className="auth-message" role="alert">
                {error}
              </p>
            )}
            <Button className="auth-submit" type="submit" disabled={busy}>
              {busy ? (register?"Отправляем код…":"Входим…") : register ? "Создать аккаунт" : "Войти"}
            </Button>
          </form>
          {existing&&<div className="auth-existing"><a href="#login">Войти в аккаунт</a><button type="button" onClick={()=>setChallenge({request:{email:email.trim(),purpose:'reset'}})}>Восстановить пароль</button></div>}
          {live&&!register&&<button type="button" style={{marginTop:18}} onClick={()=>{if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){setError('Сначала введите адрес почты');return}setChallenge({request:{email:email.trim(),purpose:'reset'}})}}>Забыли пароль?</button>}
          {!live && (
            <>
              <div className="auth-preview-note">
                Предварительный просмотр интерфейса
              </div>
              <a className="auth-demo" href="#wms">
                Посмотреть рабочее пространство
              </a>
            </>
          )}
        </section>}
      </div>
      <footer className="auth-footer">
        <a href="#welcome">На главную</a>
        <span>supply · ВМС для фулфилментов</span>
      </footer>
    </main>
  );
}
