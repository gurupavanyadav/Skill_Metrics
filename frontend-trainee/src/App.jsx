import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import ConsentDashboard from './pages/ConsentDashboard';

function App() {
  const [token, setToken] = useState(localStorage.getItem('trainee_token'));

  return (
    <BrowserRouter>
      <Routes>
        <Route 
          path="/login" 
          element={!token ? <Login setToken={setToken} /> : <Navigate to="/" />} 
        />
        <Route 
          path="/" 
          element={token ? <ConsentDashboard /> : <Navigate to="/login" />} 
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
