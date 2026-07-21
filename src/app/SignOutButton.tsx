'use client';

export function SignOutButton() {
  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.assign('/login');
  }

  return (
    <button className="btn" type="button" onClick={signOut}>
      Sign out
    </button>
  );
}
