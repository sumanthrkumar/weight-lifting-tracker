function WorkoutCard(properties) {
    return (
        <div className="card">
            <h3>{properties.title}</h3>
            <p>Last performed on {properties.date}</p>
        </div>
    )
}

export default WorkoutCard