export default function Avatar({ user, size = 'md', className = '' }) {
  if (!user) return null;

  if (user.is_default_admin) {
    return (
      <div className={`avatar avatar-${size} ${className}`}>
        <img src="/avatar/admin.png" alt="Admin" />
      </div>
    );
  }

  const initials = (() => {
    const name = user.display_name || user.name || '';
    const parts = name.trim().split(' ').filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return '??';
  })();

  const colors = ['#1a73e8','#ea4335','#34a853','#fa7b17','#a142f4','#00897b','#e91e8c','#0097a7'];
  const colorIdx = (user.name || '').charCodeAt(0) % colors.length;
  const bg = colors[colorIdx];

  return (
    <div className={`avatar avatar-${size} ${className}`} style={{ background: user.avatar ? undefined : bg }}>
      {user.avatar
        ? <img src={user.avatar} alt={initials} />
        : initials
      }
    </div>
  );
}
