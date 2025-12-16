import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import WorkoutList from './WorkoutList'
import WorkoutDetails from './WorkoutDetails'
import Auth from './Auth'
import './App.css'

function App() {
    const [session, setSession] = useState(null)
    const [selectedWorkout, setSelectedWorkout] = useState(null)

    useEffect(() => {
      // Check active session on load
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session)
      })

      // Listen for changes (Login, Logout)
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        setSession(session)
      })

      return () => subscription.unsubscribe()
    }, [])

    if (!session) {
      return <Auth />
    }

    return (
      <div className="app-container">
          {/* Simple Header with Logout */}
          <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr', 
              alignItems: 'center',
              marginBottom: '20px',
              width: '100%',
              padding: '0 2rem',
              boxSizing: 'border-box'
          }}>
              <div></div>

              <header className='navbar' style={{ display: 'flex', justifyContent: 'center' }}>
                  <h1 style={{ margin: 0 }}>Lifting Tracker</h1>
              </header>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button 
                      onClick={() => supabase.auth.signOut()}
                      style={{
                          background: '#333', 
                          color: 'white', 
                          border: 'none', 
                          padding: '8px 16px', 
                          borderRadius: '4px', 
                          cursor: 'pointer'
                      }}
                  >
                      Sign Out
                  </button>
              </div>
          </div>

        {selectedWorkout ? (
          <WorkoutDetails 
              workout={selectedWorkout} 
              onBack={() => setSelectedWorkout(null)} 
          />
        ) : (
          <WorkoutList 
              onWorkoutClick={setSelectedWorkout} 
          />
        )}
      </div>
    )
}

export default App