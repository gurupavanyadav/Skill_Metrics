import React, { useState } from 'react';
import { API_BASE_URL } from '../config';
import { Smartphone, Lock, ArrowRight } from 'lucide-react';

export default function Login({ setToken }) {
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const requestOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      // Hardcoded API URL for development. Should be in .env
      const res = await fetch(`${API_BASE_URL}/api/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to request OTP');
      
      // Move to OTP step
      setStep(2);
      // In local development, the generated OTP is logged to the backend terminal

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid OTP');
      
      localStorage.setItem('trainee_token', data.token);
      setToken(data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '400px', padding: '40px 30px' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <div style={{ 
            background: 'rgba(255, 64, 92, 0.2)', 
            width: '64px', height: '64px', 
            borderRadius: '50%', 
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px auto',
            color: 'hsl(var(--primary))'
          }}>
            {step === 1 ? <Smartphone size={32} /> : <Lock size={32} />}
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '8px' }}>
            {step === 1 ? 'Welcome Back' : 'Verify Identity'}
          </h2>
          <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>
            {step === 1 ? 'Enter your registered phone number to securely access your trainee portal.' : `Enter the 6-digit OTP sent to ${phone}`}
          </p>
        </div>

        {error && (
          <div style={{ background: 'rgba(255, 50, 50, 0.1)', color: 'hsl(var(--danger))', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '0.9rem', textAlign: 'center' }}>
            {error}
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={requestOtp} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'hsl(var(--text-muted))', marginBottom: '8px' }}>Phone Number</label>
              <input 
                type="tel" 
                placeholder="e.g. 9876543210" 
                className="input-field"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn-primary" disabled={loading || !phone}>
              {loading ? 'Sending OTP...' : 'Send OTP'}
              <ArrowRight size={18} />
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'hsl(var(--text-muted))', marginBottom: '8px' }}>One Time Password</label>
              <input 
                type="text" 
                placeholder="123456" 
                className="input-field"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                maxLength={6}
                required
              />
            </div>
            <button type="submit" className="btn-primary" disabled={loading || otp.length < 6}>
              {loading ? 'Verifying...' : 'Secure Login'}
              <ArrowRight size={18} />
            </button>
            <button 
              type="button"
              onClick={() => setStep(1)}
              style={{ background: 'transparent', border: 'none', color: 'hsl(var(--text-muted))', cursor: 'pointer', fontSize: '0.9rem', marginTop: '-10px' }}
            >
              Change Phone Number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
