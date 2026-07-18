import { ChevronsUpDown, Package, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenuButton } from '@/components/ui/sidebar';

interface PackageSwitcherProps {
  bidPackages: any[];
  selectedPackage: any | null;
  onSelect: (id: number) => void;
}

export function PackageSwitcher({
  bidPackages,
  selectedPackage,
  onSelect,
}: PackageSwitcherProps) {
  if (!bidPackages || bidPackages.length === 0) {
    return (
      <SidebarMenuButton tooltip="Bid package" disabled>
        <Package className="h-4 w-4" />
        <span className="text-sidebar-foreground/60">No bid package</span>
      </SidebarMenuButton>
    );
  }

  const sorted = bidPackages
    .slice()
    .sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          tooltip="Switch bid package"
          data-testid="sidebar-package-switcher"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
            <Package className="h-4 w-4" />
          </div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-medium">
              {selectedPackage
                ? `${selectedPackage.month} ${selectedPackage.year}`
                : 'Select package'}
            </span>
            {selectedPackage ? (
              <span className="text-xs text-sidebar-foreground/60">
                {selectedPackage.base} {selectedPackage.aircraft}
                {selectedPackage.status !== 'completed'
                  ? ` · ${selectedPackage.status}`
                  : ''}
              </span>
            ) : null}
          </div>
          {bidPackages.length > 1 && (
            <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-sidebar-foreground/60" />
          )}
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuLabel>Bid packages</DropdownMenuLabel>
        {sorted.map(pkg => (
          <DropdownMenuItem key={pkg.id} onClick={() => onSelect(pkg.id)}>
            <span className="flex-1 truncate">
              {pkg.month} {pkg.year} · {pkg.base} {pkg.aircraft}
              {pkg.status !== 'completed' ? ` (${pkg.status})` : ''}
            </span>
            {selectedPackage?.id === pkg.id && (
              <Check className="ml-2 h-4 w-4 shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
