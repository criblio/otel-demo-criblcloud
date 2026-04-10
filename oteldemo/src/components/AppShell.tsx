import { Outlet } from 'react-router-dom';
import NavBar from './NavBar';
import s from './AppShell.module.css';

export default function AppShell() {
  return (
    <div className={s.shell}>
      <NavBar />
      <main className={s.content}>
        <Outlet />
      </main>
    </div>
  );
}
