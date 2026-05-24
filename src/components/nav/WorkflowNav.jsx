import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu';
import { GitBranch, ChevronDown } from 'lucide-react';

/** Pages registered in pages.config.js — update when new workflow pages ship. */
const REGISTERED_PAGE_NAMES = new Set([
  'Inquiries',
  'Clients',
  'Projects',
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

  return currentPageName === pageName;
};

export default function WorkflowNav({ currentPageName, userRole }) {
  const items = getWorkflowItemsForRole(userRole);

  if (items.length === 0) {
    return null;
  }

  const isActive = isWorkflowNavActive(currentPageName);

  return (
    <NavigationMenu dir="rtl">
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger
            className={cn(
              navigationMenuTriggerStyle(),
              'h-auto gap-2 px-3 py-2 data-[state=open]:bg-accent',
              isActive && 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
            )}
          >
            <GitBranch className="w-4 h-4 shrink-0" />
            <span className="flex flex-col items-start leading-tight text-right">
              <span className="text-sm font-medium">Workflow</span>
              <span
                className={cn(
                  'text-[10px] font-normal',
                  isActive ? 'text-primary-foreground/80' : 'text-muted-foreground',
                )}
              >
                תהליך עבודה
              </span>
            </span>
            <ChevronDown className="w-3 h-3 shrink-0 opacity-60" aria-hidden="true" />
          </NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul
              className="grid w-[240px] gap-0.5 p-2 text-right"
              dir="rtl"
            >
              {items.map((item) => (
                <li key={item.pageName}>
                  {item.enabled ? (
                    <NavigationMenuLink asChild>
                      <Link
                        to={item.href}
                        className={cn(
                          'block select-none rounded-md px-3 py-2 text-sm leading-none no-underline outline-none transition-colors',
                          'hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground',
                          isWorkflowItemActive(item.pageName, currentPageName) &&
                            'bg-accent font-medium',
                        )}
                      >
                        {item.label}
                      </Link>
                    </NavigationMenuLink>
                  ) : (
                    <span
                      className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground opacity-60 cursor-not-allowed"
                      aria-disabled="true"
                    >
                      <span>{item.label}</span>
                      <span className="text-xs shrink-0">בקרוב</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}

/** Compact workflow links for narrow viewports (no hover menu). */
export function WorkflowNavMobile({ currentPageName, userRole }) {
  const items = getWorkflowItemsForRole(userRole);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 border-t pt-3 mt-2 w-full" dir="rtl">
      <p className="text-xs font-semibold text-muted-foreground px-1 mb-1">
        Workflow · תהליך עבודה
      </p>
      {items.map((item) =>
        item.enabled ? (
          <Link key={item.pageName} to={item.href}>
            <Button
              variant={
                isWorkflowItemActive(item.pageName, currentPageName) ? 'default' : 'ghost'
              }
              className="w-full justify-start gap-2"
              size="sm"
            >
              {item.label}
            </Button>
          </Link>
        ) : (
          <Button
            key={item.pageName}
            variant="ghost"
            className="w-full justify-between gap-2 opacity-50 cursor-not-allowed"
            size="sm"
            disabled
          >
            <span>{item.label}</span>
            <span className="text-xs">בקרוב</span>
          </Button>
        ),
      )}
    </div>
  );
}
