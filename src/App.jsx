import { useState } from 'react'
import './App.css'
import WorkoutCard from './WorkoutCard.jsx'

function App() {
  
  return (
    <div className="app-container">
      <header class="navbar">
        <h1>Lifting Tracker</h1>
      </header>
    
      <main className='content'>
        <WorkoutCard title="Leg Day" date="Dec 9th, 2025" />
        <WorkoutCard title="Push Day" date="Dec 7th, 2025" /> 
      </main>
    </div>
  )
}

export default App
