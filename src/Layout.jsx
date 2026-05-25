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
  LogOut,
  ClipboardList,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import WorkflowNav from '@/components/nav/WorkflowNav';

const resolveActiveNavPage = (currentPageName) => {
  if (currentPageName === 'ProjectDetails' || currentPageName === 'InvoiceUpload') {
    return 'Projects';
  }

  if (currentPageName === 'ClientDetails' || currentPageName === 'ClientForm') {
    return 'Clients';
  }

  if (currentPageName === 'InquiryForm') {
    return 'Inquiries';
  }

  if (currentPageName === 'SignedProposalForm') {
    return 'SignedProposals';
  }

  return currentPageName;
};

export default function Layout({ children, currentPageName }) {
  const activeNavPage = resolveActiveNavPage(currentPageName);
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

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation */}
      <nav className="border-b bg-card overflow-visible relative z-40">
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
              <div className="flex items-center gap-2 flex-wrap">
                {navItems.map(item => {
                  const Icon = item.icon;
                  const isActive = activeNavPage === item.name;
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
                {userRole && (
                  <WorkflowNav
                    currentPageName={currentPageName}
                    userRole={userRole}
                  />
                )}
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
