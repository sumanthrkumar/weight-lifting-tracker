import { useState } from 'react'
import { supabase } from './supabaseClient'

export default function Auth() {
    const [loading, setLoading] = useState(false)
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [isSignUp, setIsSignUp] = useState(false)

    const handleAuth = async (e) => {
        e.preventDefault()
        setLoading(true)

        let error
        
        if (isSignUp) {
            // Create new user
            const { error: signUpError } = await supabase.auth.signUp({ email, password })
            error = signUpError
        } else {
            // Login existing user
            const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
            error = signInError
        }

        if (error) {
            alert(error.message)
        } 
        // If successful, Supabase automatically updates the session, 
        // which App.jsx will detect to switch screens.
        
        setLoading(false)
    }

    return (
        <div style={{
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '100vh', 
            background: '#1a1a1a'
        }}>
        <div style={{
            background: 'white', 
            padding: '2rem', 
            borderRadius: '10px', 
            width: '300px',
            textAlign: 'center'
        }}>
            <h1 style={{color: '#333', marginTop: 0}}>Lifting Tracker</h1>
            <p style={{color: '#666', marginBottom: '20px'}}>
                {isSignUp ? "Create an account" : "Sign in to your account"}
            </p>
            
            <form onSubmit={handleAuth}>
            <input
                type="email"
                placeholder="Your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{width: '100%', padding: '10px', marginBottom: '10px', boxSizing: 'border-box'}}
                required
            />
            <input
                type="password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{width: '100%', padding: '10px', marginBottom: '20px', boxSizing: 'border-box'}}
                required
            />
            <button 
                disabled={loading}
                style={{
                    width: '100%', 
                    padding: '10px', 
                    background: '#4c8df6', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '5px', 
                    cursor: 'pointer',
                    fontWeight: 'bold'
                }}
            >
                {loading ? 'Processing...' : (isSignUp ? 'Sign Up' : 'Log In')}
            </button>
            </form>

            <p style={{marginTop: '20px', fontSize: '0.9rem', color: '#333'}}>
                {isSignUp ? "Already have an account?" : "Don't have an account?"} 
                {' '}
                <button 
                    onClick={() => setIsSignUp(!isSignUp)}
                    style={{background: 'none', border: 'none', color: '#4c8df6', cursor: 'pointer', textDecoration: 'underline'}}
                >
                    {isSignUp ? "Log In" : "Sign Up"}
                </button>
            </p>
        </div>
        </div>
    )
}