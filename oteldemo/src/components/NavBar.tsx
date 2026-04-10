import { NavLink, useNavigate } from 'react-router-dom';
import { useState, type KeyboardEvent } from 'react';
import s from './NavBar.module.css';

const tabs = [
  { label: 'Home', to: '/', end: true },
  { label: 'Search', to: '/search' },
  { label: 'Compare', to: '/compare' },
  { label: 'System Architecture', to: '/architecture' },
];

export default function NavBar() {
  const navigate = useNavigate();
  const [traceId, setTraceId] = useState('');

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && traceId.trim()) {
      navigate(`/trace/${traceId.trim()}`);
      setTraceId('');
    }
  }

  return (
    <nav className={s.navbar}>
      <NavLink to="/" end className={s.brand}>
        <svg className={s.brandIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        Trace Explorer
      </NavLink>

      <div className={s.tabs}>
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => `${s.tab} ${isActive ? s.tabActive : ''}`}
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      <div className={s.spacer} />

      <input
        className={s.traceInput}
        type="text"
        placeholder="Lookup by Trace ID…"
        value={traceId}
        onChange={(e) => setTraceId(e.target.value)}
        onKeyDown={handleKey}
      />
    </nav>
  );
}
