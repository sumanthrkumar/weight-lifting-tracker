function WorkoutList() {

    //Fake Data to simulate workouts
    const workouts = [
        { id: 1, title: "Leg Day", date: "Dec 9th" },
        { id: 2, title: "Push Day", date: "Dec 7th" },
        { id: 3, title: "Pull Day", date: "Dec 5th" },
        { id: 4, title: "Cardio", date: "Dec 4th" }
    ]   

    return (

        <div className="workout-list">
            <div className="card">
                <h3>Leg Day</h3>
                <p>Last performed on Dec 9th, 2025</p>
            </div>

            <div className="card">
                <h3>Push Day</h3>
                <p>Last performed on Dec 7th, 2025</p>
            </div>
        </div>
    )
}

export default WorkoutList