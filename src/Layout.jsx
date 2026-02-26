import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { 
  LayoutDashboard, 
  Users, 
  FolderKanban,
  Sparkles,
  UserCog,
  LogOut 
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';

export default function Layout({ children, currentPageName }) {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'office_manager';
  const isProjectWorker = currentUser?.role === 'project_worker';
  const isTaskWorker = currentUser?.role === 'task_worker';

  const allNavItems = [
    { name: 'Dashboard', label: 'דשבורד', icon: LayoutDashboard, roles: ['admin', 'office_manager', 'project_worker'] },
    { name: 'Clients', label: 'לקוחות', icon: Users, roles: ['admin', 'office_manager'] },
    { name: 'Projects', label: 'פרויקטים', icon: FolderKanban, roles: ['admin', 'office_manager', 'project_worker'] },
    { name: 'Assistant', label: 'עוזר AI', icon: Sparkles, roles: ['admin', 'office_manager'] },
    { name: 'Users', label: 'משתמשים', icon: UserCog, roles: ['admin', 'office_manager'] },
  ];

  const navItems = allNavItems.filter(item => 
    !item.roles || item.roles.includes(currentUser?.role)
  );

  const handleLogout = () => {
    base44.auth.logout();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation */}
      <nav className="border-b bg-card">
        <div className="max-w-[1400px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              <div>
                <Link to={createPageUrl('Dashboard')} className="text-xl font-bold">
                  ENG Aharon D
                </Link>
                {currentUser && (
                  <p className="text-xs text-muted-foreground">
                    {currentUser.full_name} - {
                      currentUser.role === 'admin' ? 'מנהל' :
                      currentUser.role === 'office_manager' ? 'מנהלת משרד' :
                      currentUser.role === 'project_worker' ? 'עובד פרויקטים' :
                      'מבצע משימות'
                    }
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {navItems.map(item => {
                  const Icon = item.icon;
                  const isActive = currentPageName === item.name;
                  return (
                    <Link key={item.name} to={createPageUrl(item.name)}>
                      <Button 
                        variant={isActive ? "default" : "ghost"}
                        className="gap-2"
                      >
                        <Icon className="w-4 h-4" />
                        {item.label}
                      </Button>
                    </Link>
                  );
                })}
              </div>
            </div>
            <Button variant="ghost" onClick={handleLogout} className="gap-2">
              <LogOut className="w-4 h-4" />
              יציאה
            </Button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main>
        {children}
      </main>
    </div>
  );
}