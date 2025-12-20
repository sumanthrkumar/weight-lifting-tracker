# Weight Lifting Tracker

A robust and intuitive web application designed for tracking weight lifting workouts. Built with React and Vite, this project leverages Supabase as its backend, providing seamless data management for users to log, view, edit, and delete their workout sessions. It aims to offer a clean, efficient, and modern interface for personal fitness tracking.

## Features

*   **Workout Logging:** Easily add new weight lifting workout entries.
*   **Workout Overview:** View a comprehensive list of all recorded workout sessions.
*   **Edit Functionality:** Modify details of existing workout entries.
*   **Delete Functionality:** Remove workout entries when no longer needed.
*   **Persistent Storage:** Data is securely stored and managed using Supabase.
*   **Modern UI:** A clean and responsive user interface built with React.

## Technologies Used

*   **Frontend:**
    *   React 19
    *   Vite (with Rolldown)
    *   JavaScript
    *   CSS
*   **Backend:**
    *   Supabase (for database and API)

## Installation

Follow these steps to set up and run the project locally:

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/your-username/weight-lifting-tracker.git
    cd weight-lifting-tracker
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Supabase Setup:**
    This project uses Supabase for its backend. You'll need to set up a new Supabase project and configure your environment variables.

    *   Go to [Supabase](https://supabase.com/) and create a new project.
    *   In your Supabase project, navigate to the `Table editor` and create a new table. A suggested table name is `workouts`. You might include columns like:
        *   `id` (Primary Key, UUID, Default: `gen_random_uuid()`)
        *   `created_at` (Timestamp, Default: `now()`)
        *   `date` (Date)
        *   `exercise` (Text)
        *   `weight` (Numeric)
        *   `reps` (Integer)
        *   `sets` (Integer)
    *   Navigate to `Project Settings` > `API`. Copy your `Project URL` and `Anon Public` key.

4.  **Environment Variables:**
    Create a `.env` file in the root of your project directory and add the following:

    ```env
    VITE_SUPABASE_URL="YOUR_SUPABASE_PROJECT_URL"
    VITE_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
    ```
    Replace `"YOUR_SUPABASE_PROJECT_URL"` and `"YOUR_SUPABASE_ANON_KEY"` with the values copied from your Supabase project.

## Usage

Once the installation and setup are complete, you can run the application:

*   **Development Mode:**
    To start the development server with hot module replacement:
    ```bash
    npm run dev
    ```
    The application will typically be accessible at `http://localhost:5173`.

*   **Build for Production:**
    To compile the project for production deployment:
    ```bash
    npm run build
    ```
    This command will create an optimized `dist` directory.

*   **Preview Production Build:**
    To serve the production build locally:
    ```bash
    npm run preview
    ```

*   **Linting:**
    To run ESLint for code quality checks:
    ```bash
    npm run lint
    ```