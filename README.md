# Tech Ambit Backend

This is the backend repository for the Tech Ambit project.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Tech Stack](#tech-stack)

## Prerequisites

Ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v14 or higher recommended)
- [npm](https://www.npmjs.com/)
- [MongoDB](https://www.mongodb.com/) (Local or Atlas)
- [Redis](https://redis.io/) (Optional, if used for caching/queues)

## Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd tech_ambit_backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Configuration

1. Create a `.env` file in the root directory based on the example:

   ```bash
   cp .env.example .env
   ```

2. Update the `.env` file with your configuration values (Database URL, API keys, etc.).

## Scripts

- **Start Development Server**:

  ```bash
  npm run dev
  ```

  Runs the server with `nodemon` for hot-reloading.

- **Start Production Server**:

  ```bash
  npm start
  ```

  Runs the server using `node`.

- **Lint Code**:
  ```bash
  npm run lint
  ```
  Formats code using Prettier.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB (Mongoose)
- **Caching**: Redis
- **Authentication**: JWT, bcrypt
- **HTTP Client**: Axios
