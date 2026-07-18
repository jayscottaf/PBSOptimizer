import {
  Plane,
  Search,
  Star,
  Calendar,
  ClipboardList,
  TrendingUp,
  User,
  Moon,
  Sun,
  Monitor,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PackageSwitcher } from '@/components/layout/package-switcher';

export const NAV_ITEMS = [
  { value: 'dashboard', label: 'Dashboard', icon: Search },
  { value: 'favorites', label: 'Favorites', icon: Star },
  { value: 'calendar', label: 'Calendar', icon: Calendar },
  { value: 'bidBuilder', label: 'Bid Builder', icon: ClipboardList },
  { value: 'trends', label: 'Trends', icon: TrendingUp },
] as const;

interface AppSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  currentUser: { name?: string; seniorityNumber?: number } | null | undefined;
  seniorityPercentile: number | string | null | undefined;
  bidPackages: any[];
  selectedPackage: any | null;
  onSelectPackage: (id: number) => void;
  onOpenProfile: () => void;
}

function ThemeMenuItem() {
  const { theme, setTheme } = useTheme();
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton tooltip="Theme">
          <Icon className="h-4 w-4" />
          <span className="capitalize">Theme: {theme ?? 'system'}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <Sun className="mr-2 h-4 w-4" /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <Moon className="mr-2 h-4 w-4" /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          <Monitor className="mr-2 h-4 w-4" /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppSidebar({
  activeTab,
  onTabChange,
  currentUser,
  seniorityPercentile,
  bidPackages,
  selectedPackage,
  onSelectPackage,
  onOpenProfile,
}: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="PBS Bid Optimizer" asChild>
              <div className="cursor-default">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Plane className="h-4 w-4" />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="font-semibold">PBS Optimizer</span>
                  <span className="text-xs text-sidebar-foreground/60">
                    Delta bid analysis
                  </span>
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(item => (
                <SidebarMenuItem key={item.value}>
                  <SidebarMenuButton
                    tooltip={item.label}
                    isActive={activeTab === item.value}
                    onClick={() => onTabChange(item.value)}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <PackageSwitcher
              bidPackages={bidPackages}
              selectedPackage={selectedPackage}
              onSelect={onSelectPackage}
            />
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarSeparator />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Profile" onClick={onOpenProfile}>
              <User className="h-4 w-4" />
              <div className="flex min-w-0 flex-col leading-tight">
                <span className="truncate">
                  {currentUser?.name || 'Set up profile'}
                </span>
                {currentUser?.seniorityNumber ? (
                  <span className="text-xs text-sidebar-foreground/60">
                    Seniority #{currentUser.seniorityNumber}
                    {seniorityPercentile !== null &&
                    seniorityPercentile !== undefined
                      ? ` · ${seniorityPercentile}%`
                      : ''}
                  </span>
                ) : null}
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <ThemeMenuItem />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
