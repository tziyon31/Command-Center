import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { GitBranch } from 'lucide-react';

/** Pages registered in pages.config.js — update when new workflow pages ship. */
const REGISTERED_PAGE_NAMES = new Set([
  'Inquiries',
  'Clients',
  'Projects',
  'SignedProposals',
]);

const WORKFLOW_ITEMS = [
  { pageName: 'Inquiries', label: 'פניות', roles: ['admin', 'office_manager'] },
  { pageName: 'Clients', label: 'לקוחות', roles: ['admin', 'office_manager'] },
  { pageName: 'Projects', label: 'פרויקטים', roles: ['admin', 'office_manager', 'project_worker'] },
  { pageName: 'SignedProposals', label: 'הצעות חתומות', roles: ['admin', 'office_manager'] },
  { pageName: 'WorkStages', label: 'שלבי עבודה', roles: ['admin', 'office_manager'] },
  { pageName: 'Invoices', label: 'חשבוניות', roles: ['admin', 'office_manager'] },
  { pageName: 'Collections', label: 'הכנסות', roles: ['admin', 'office_manager'] },
];

const WORKFLOW_ACTIVE_PAGES = new Set([
  'Inquiries',
  'InquiryForm',
  'Clients',
  'ClientDetails',
  'Projects',
  'ProjectDetails',
  'InvoiceUpload',
  'SignedProposals',
  'SignedProposalForm',
]);

export function getWorkflowItemsForRole(role) {
  return WORKFLOW_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(role),
  ).map((item) => ({
    ...item,
    enabled: REGISTERED_PAGE_NAMES.has(item.pageName),
    href: createPageUrl(item.pageName),
  }));
}

export function isWorkflowNavActive(pageName) {
  return WORKFLOW_ACTIVE_PAGES.has(pageName);
}

const isWorkflowItemActive = (pageName, currentPageName) => {
  if (pageName === 'Inquiries') {
    return currentPageName === 'Inquiries' || currentPageName === 'InquiryForm';
  }

  if (pageName === 'Clients') {
    return currentPageName === 'Clients' || currentPageName === 'ClientDetails';
  }

  if (pageName === 'Projects') {
    return (
      currentPageName === 'Projects' ||
      currentPageName === 'ProjectDetails' ||
      currentPageName === 'InvoiceUpload'
    );
  }

  if (pageName === 'SignedProposals') {
    return currentPageName === 'SignedProposals' || currentPageName === 'SignedProposalForm';
  }

  return currentPageName === pageName;
};

export default function WorkflowNav({ currentPageName, userRole }) {
  const items = getWorkflowItemsForRole(userRole);
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef(null);

  if (items.length === 0) {
    return null;
  }

  const isActive = isWorkflowNavActive(currentPageName);

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  };

  const handleOpen = () => {
    clearCloseTimer();
    setOpen(true);
  };

  return (
    <div
      className="relative"
      onMouseEnter={handleOpen}
      onMouseLeave={scheduleClose}
    >
      <Button
        type="button"
        variant={isActive ? 'default' : 'ghost'}
        className="gap-2"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        <GitBranch className="w-4 h-4" />
        Workflow
      </Button>

      {open && (
        <div
          className="absolute top-full right-0 z-50 mt-1 min-w-[200px] rounded-md border bg-popover py-1 shadow-md"
          dir="rtl"
          onMouseEnter={handleOpen}
          onMouseLeave={scheduleClose}
        >
          <p className="px-3 py-1.5 text-xs text-muted-foreground border-b mb-1">
            תהליך עבודה
          </p>
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.pageName}>
                {item.enabled ? (
                  <Link
                    to={item.href}
                    className={cn(
                      'block px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors',
                      isWorkflowItemActive(item.pageName, currentPageName) &&
                        'bg-accent font-medium',
                    )}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-muted-foreground opacity-60 cursor-not-allowed"
                    aria-disabled="true"
                  >
                    <span>{item.label}</span>
                    <span className="text-xs shrink-0">בקרוב</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
