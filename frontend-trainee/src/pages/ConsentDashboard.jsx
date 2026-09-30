import React, { useEffect, useState } from 'react';
import { API_BASE_URL } from '../config';
import { Shield, ShieldAlert, LogOut, CheckCircle2, Briefcase, GraduationCap, Clock } from 'lucide-react';

export default function ConsentDashboard() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const token = localStorage.getItem('trainee_token');
      const res = await fetch(`${API_BASE_URL}/api/trainee/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) {
        if(res.status === 401 || res.status === 403) logout();
        throw new Error('Failed to fetch profile');
      }
      
      const data = await res.json();
      setProfile(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const toggleConsent = async (e) => {
    const newStatus = e.target.checked;
    setUpdating(true);
    try {
      const token = localStorage.getItem('trainee_token');
      const res = await fetch(`${API_BASE_URL}/api/trainee/consent`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ consentStatus: newStatus })
      });
      
      if (!res.ok) throw new Error('Failed to update consent');
      
      setProfile(prev => ({ ...prev, consentStatus: newStatus }));
    } catch (error) {
      console.error(error);
      alert('Error updating consent status. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('trainee_token');
    window.location.href = '/login';
  };

  if (loading) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading your secure profile...</div>;
  }

  if (!profile) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Error loading profile.</div>;
  }

  return (
    <div style={{ flex: 1, padding: '20px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
      
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px', marginTop: '20px' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: '700' }}>Hello, {profile.name}</h1>
          <p style={{ color: 'hsl(var(--text-muted))' }}>ID: {profile.systemId}</p>
        </div>
        <button 
          onClick={logout}
          style={{ background: 'rgba(255,255,255,0.1)', border: 'none', padding: '10px 16px', borderRadius: '8px', color: 'white', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
        >
          <LogOut size={16} /> Logout
        </button>
      </header>

      {/* Consent Card */}
      <div className="glass-panel animate-fade-in" style={{ padding: '30px', position: 'relative', overflow: 'hidden' }}>
        
        {/* Background glow based on status */}
        <div style={{ 
          position: 'absolute', top: '-50%', left: '-50%', width: '200%', height: '200%', 
          background: profile.consentStatus ? 'radial-gradient(circle, rgba(46, 204, 113, 0.05) 0%, transparent 60%)' : 'radial-gradient(circle, rgba(231, 76, 60, 0.05) 0%, transparent 60%)',
          pointerEvents: 'none', zIndex: 0
        }} />

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '20px' }}>
            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
              <div style={{ 
                background: profile.consentStatus ? 'rgba(46, 204, 113, 0.2)' : 'rgba(231, 76, 60, 0.2)',
                color: profile.consentStatus ? 'hsl(var(--success))' : 'hsl(var(--danger))',
                padding: '16px', borderRadius: '16px'
              }}>
                {profile.consentStatus ? <Shield size={32} /> : <ShieldAlert size={32} />}
              </div>
              
              <div>
                <h2 style={{ fontSize: '1.4rem', fontWeight: '600', marginBottom: '8px' }}>Privacy & Data Consent</h2>
                <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.95rem', lineHeight: '1.5', maxWidth: '400px' }}>
                  {profile.consentStatus 
                    ? "You are currently sharing your training and placement data with the Kaushal Outcome Platform to help improve future skilling initiatives."
                    : "Your data tracking is currently paused. We respect your privacy. You can opt-in at any time to help improve future skilling initiatives."}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <input 
                type="checkbox" 
                className="toggle-switch" 
                checked={profile.consentStatus}
                onChange={toggleConsent}
                disabled={updating}
              />
              <span style={{ fontSize: '0.8rem', color: profile.consentStatus ? 'hsl(var(--success))' : 'hsl(var(--danger))', fontWeight: '600' }}>
                {profile.consentStatus ? 'ACTIVE' : 'INACTIVE'}
              </span>
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '12px', marginTop: '10px' }}>
            <h4 style={{ fontSize: '0.9rem', marginBottom: '10px', color: 'hsl(var(--text-muted))' }}>What this means:</h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <li style={{ display: 'flex', gap: '10px', fontSize: '0.9rem', color: profile.consentStatus ? 'white' : 'hsl(var(--text-muted))', opacity: profile.consentStatus ? 1 : 0.5 }}>
                <CheckCircle2 size={18} color={profile.consentStatus ? "hsl(var(--success))" : "gray"} /> Allow automated follow-up messages via SMS/WhatsApp.
              </li>
              <li style={{ display: 'flex', gap: '10px', fontSize: '0.9rem', color: profile.consentStatus ? 'white' : 'hsl(var(--text-muted))', opacity: profile.consentStatus ? 1 : 0.5 }}>
                <CheckCircle2 size={18} color={profile.consentStatus ? "hsl(var(--success))" : "gray"} /> Include your anonymized placement data in cohort analysis.
              </li>
              <li style={{ display: 'flex', gap: '10px', fontSize: '0.9rem', color: profile.consentStatus ? 'white' : 'hsl(var(--text-muted))', opacity: profile.consentStatus ? 1 : 0.5 }}>
                <CheckCircle2 size={18} color={profile.consentStatus ? "hsl(var(--success))" : "gray"} /> Allow call centre operators to view your timeline for assistance.
              </li>
            </ul>
          </div>

        </div>
      </div>

      {/* Unified Trainee Timeline */}
      <div style={{ marginTop: '40px' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: '600', marginBottom: '20px' }}>Your Training & Career Timeline</h2>
        
        {(!profile.enrollments?.length && !profile.outcomes?.length) ? (
          <div className="glass-panel" style={{ padding: '30px', textAlign: 'center', color: 'hsl(var(--text-muted))' }}>
            <Clock size={40} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
            <p>Your timeline is currently empty.</p>
          </div>
        ) : (
          <div style={{ position: 'relative', paddingLeft: '30px' }}>
            {/* Vertical Line */}
            <div style={{ position: 'absolute', left: '11px', top: '10px', bottom: '10px', width: '2px', background: 'rgba(255,255,255,0.1)' }} />
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
              {/* Render Enrollments */}
              {profile.enrollments?.map((enrollment, idx) => (
                <div key={`env-${idx}`} style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: '-30px', top: '0', background: 'hsl(var(--background))', padding: '4px' }}>
                    <div style={{ background: 'hsl(var(--primary))', width: '16px', height: '16px', borderRadius: '50%' }} />
                  </div>
                  <div className="glass-panel" style={{ padding: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                      <GraduationCap size={20} color="hsl(var(--primary))" />
                      <h3 style={{ fontSize: '1.1rem', fontWeight: '600' }}>{enrollment.course.name}</h3>
                      <span style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>
                        {enrollment.status}
                      </span>
                    </div>
                    {enrollment.certificationDate && (
                      <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>
                        Certified on: {new Date(enrollment.certificationDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {/* Render Outcomes */}
              {profile.outcomes?.map((outcome, idx) => (
                <div key={`out-${idx}`} style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: '-30px', top: '0', background: 'hsl(var(--background))', padding: '4px' }}>
                    <div style={{ background: 'hsl(var(--success))', width: '16px', height: '16px', borderRadius: '50%' }} />
                  </div>
                  <div className="glass-panel" style={{ padding: '20px', borderLeft: '4px solid hsl(var(--success))' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                      <Briefcase size={20} color="hsl(var(--success))" />
                      <h3 style={{ fontSize: '1.1rem', fontWeight: '600' }}>{outcome.type.replace('_', ' ')}</h3>
                      <span style={{ marginLeft: 'auto', background: 'rgba(46, 204, 113, 0.2)', color: 'hsl(var(--success))', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>
                        {outcome.verificationStatus}
                      </span>
                    </div>
                    {outcome.employer && (
                      <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.9rem', marginBottom: '5px' }}>
                        Employer: <strong style={{ color: 'white' }}>{outcome.employer.name}</strong>
                      </p>
                    )}
                    <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>
                      Started: {new Date(outcome.startDate).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
