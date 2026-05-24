import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { 
  LayoutDashboard, 
  Users, 
  FolderKanban,
  Sparkles,
  UserCog,
  LogOut,
  ClipboardList,
  Menu,
  X,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import WorkflowNav, { WorkflowNavMobile } from '@/components/nav/WorkflowNav';

const resolveActiveNavPage = (currentPageName) => {
  if (currentPageName === 'ProjectDetails' || currentPageName === 'InvoiceUpload') {
    return 'Projects';
  }

  if (currentPageName === 'ClientDetails') {
    return 'Clients';
  }

  if (currentPageName === 'InquiryForm') {
    return 'Inquiries';
  }

  return currentPageName;
};

export default function Layout({ children, currentPageName }) {
  const activeNavPage = resolveActiveNavPage(currentPageName);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const userRole = currentUser?.role;

  const allNavItems = [
    { name: 'Dashboard', label: 'דשבורד', icon: LayoutDashboard, roles: ['admin', 'office_manager', 'project_worker'] },
    { name: 'Clients', label: 'לקוחות', icon: Users, roles: ['admin', 'office_manager'] },
    { name: 'Inquiries', label: 'פניות', icon: ClipboardList, roles: ['admin', 'office_manager'] },
    { name: 'Projects', label: 'פרויקטים', icon: FolderKanban, roles: ['admin', 'office_manager', 'project_worker'] },
    { name: 'Assistant', label: 'עוזר AI', icon: Sparkles, roles: ['admin', 'office_manager'] },
    { name: 'Users', label: 'משתמשים', icon: UserCog, roles: ['admin', 'office_manager'] },
  ];

  const navItems = allNavItems.filter(item => 
    !item.roles || item.roles.includes(userRole)
  );

  const handleLogout = () => {
    base44.auth.logout();
  };

  const renderNavButton = (item) => {
    const Icon = item.icon;
    const isActive = activeNavPage === item.name;
    return (
      <Link key={item.name} to={createPageUrl(item.name)} onClick={() => setMobileMenuOpen(false)}>
        <Button 
          variant={isActive ? "default" : "ghost"}
          className="gap-2"
        >
          <Icon className="w-4 h-4" />
          {item.label}
        </Button>
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Top Navigation */}
      <nav className="border-b bg-card">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <div className="shrink-0">
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

              {/* Desktop nav */}
              <div className="hidden lg:flex items-center gap-2 flex-wrap min-w-0">
                {navItems.slice(0, 1).map(renderNavButton)}
                {userRole && (
                  <WorkflowNav
                    currentPageName={currentPageName}
                    userRole={userRole}
                  />
                )}
                {navItems.slice(1).map(renderNavButton)}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setMobileMenuOpen((open) => !open)}
                aria-label={mobileMenuOpen ? 'סגור תפריט' : 'פתח תפריט'}
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </Button>
              <Button variant="ghost" onClick={handleLogout} className="gap-2 hidden sm:flex">
                <LogOut className="w-4 h-4" />
                יציאה
              </Button>
            </div>
          </div>

          {/* Mobile nav panel */}
          {mobileMenuOpen && (
            <div className="lg:hidden mt-4 flex flex-col gap-2 border-t pt-4">
              {navItems.map(renderNavButton)}
              {userRole && (
                <WorkflowNavMobile
                  currentPageName={currentPageName}
                  userRole={userRole}
                />
              )}
              <Button variant="ghost" onClick={handleLogout} className="gap-2 justify-start sm:hidden">
                <LogOut className="w-4 h-4" />
                יציאה
              </Button>
            </div>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main>
        {children}
      </main>
    </div>
  );
}
