import { useState } from 'react'
import './App.css'
import WorkoutList from './WorkoutList.jsx'

function App() {
  
  return (
    <div className="app-container">
      <header class="navbar">
        <h1>Lifting Tracker</h1>
      </header>
    
      <main className='content'>
        <WorkoutList />
      </main>
    </div>
  )
}

export default App
