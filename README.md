# SkyCourt Warehouse System

A modern, efficient warehouse management system built with a React frontend and a Python (Flask) backend. Designed for digital inventory tracking, two-operator order workflows, and movement logging.

## 🚀 Features

- **Inventory Management:** Full CRUD operations for items, including quantity adjustments and metadata tracking.
- **Categorization:** Organize items by categories for better searchability and management.
- **Metadata Management:** Manage destinations, providers, and units to keep your data consistent.
- **Movement Logs:** Detailed history of all item movements and quantity changes.
- **Two-Operator Workflows:** Office reservations and purchase-order drafts are dispatched to Warehouse for physical fulfillment and receipt.
- **Reporting:** Generate printable reports for inventory and logs.
- **Modern UI:** Responsive and intuitive interface built with React, Tailwind CSS, and Lucide icons.
- **Desktop Ready:** Integrated with `pywebview` for a native desktop application experience.

## 🛠️ Tech Stack

### Frontend
- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS
- **State Management:** TanStack Query (React Query)
- **Icons:** Lucide React
- **Notifications:** React Hot Toast

### Backend
- **Framework:** Python (Flask)
- **Database:** SQLite / LibSQL
- **Desktop Integration:** pywebview

## 📋 Prerequisites

- **Python 3.8+**
- **Node.js 18+**
- **npm** or **yarn**

## 🔧 Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/skycourt-warehouse-system.git
cd skycourt-warehouse-system
```

### 2. Backend Setup
Create a virtual environment and install dependencies:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Frontend Setup
Navigate to the `UI` directory and install dependencies:
```bash
cd UI
npm install
cd ..
```

## 🏃 Running the Application

### Development Mode
To run the application with hot-reloading for both frontend and backend:

**Frontend:**
```bash
cd UI
npm run dev
```

**Backend:**
```bash
python run.py
```

### Production Build
To build the frontend for production:
```bash
cd UI
npm run build
```

## 📂 Project Structure

- `app/`: Flask application logic, models, services, and routes.
- `UI/`: React frontend application.
- `database/`: Database schema and SQLite files.
- `run.py`: Entry point for the application.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
