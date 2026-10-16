import { MoreHorizontal } from 'lucide-react';
import { NAV_ITEMS } from '@/components/layout/app-sidebar';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
interface MobileNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}
export function MobileNav({ activeTab, onTabChange }: MobileNavProps) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="grid grid-cols-5">
        {NAV_ITEMS.slice(0, 4).map(item => (
          <button
            key={item.value}
            type="button"
            onClick={() => onTabChange(item.value)}
            aria-current={activeTab === item.value ? 'page' : undefined}
            className={cn(
              'flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium',
              activeTab === item.value
                ? 'text-primary'
                : 'text-muted-foreground'
            )}
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium',
              NAV_ITEMS.slice(4).some(item => item.value === activeTab)
                ? 'text-primary'
                : 'text-muted-foreground'
            )}
            aria-label="More pages"
          >
            <MoreHorizontal className="h-5 w-5" />
            More
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end">
            {NAV_ITEMS.slice(4).map(item => (
              <DropdownMenuItem
                key={item.value}
                onSelect={() => onTabChange(item.value)}
              >
                <item.icon className="mr-2 h-4 w-4" />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
