function WorkoutCard(props) {
    return (
        <div className="card" onClick={props.onCardClick}>
            <h3>{props.title}</h3>
            <p>Last performed on {props.date}</p>
        </div>
    )
}

export default WorkoutCard