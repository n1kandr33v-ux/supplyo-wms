import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Landing } from './landing'
import { Auth } from './auth'
function Root(){const [route,setRoute]=useState(window.location.hash);useEffect(()=>{const change=()=>{setRoute(window.location.hash);window.scrollTo(0,0)};window.addEventListener('hashchange',change);return ()=>window.removeEventListener('hashchange',change)},[]);if(route==='#login'||route==='#register')return <Auth key={route} register={route==='#register'}/>;return ['#welcome','#features','#workflow','#questions','#pricing'].includes(route)?<Landing/>:<App/>}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
