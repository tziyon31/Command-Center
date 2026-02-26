import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { 
  LayoutDashboard, 
  Users, 
  FolderKanban, 
  LogOut 
} from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function Layout({ children, currentPageName }) {
  const navItems = [
    { name: 'Dashboard', label: 'דשבורד', icon: LayoutDashboard },
    { name: 'Clients', label: 'לקוחות', icon: Users },
    { name: 'Projects', label: 'פרויקטים', icon: FolderKanban },
  ];

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
              <Link to={createPageUrl('Dashboard')} className="text-xl font-bold">
                ENG Aharon D
              </Link>
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