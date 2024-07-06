import { Routes, Route } from 'react-router-dom'
import { React } from 'react'

import { Todos } from './Todos.js'
import { Login } from './Login.js'
import { Register } from './Register.js'

export default function App () {
  return (
    <>
      <Routes>
        <Route path="/" element={<Todos/>} />
        <Route path="/login" element={<Login/>}/>
        <Route path="/register" element={<Register/>}/>
      </Routes>
    </>
  )
}
