import { CloudUpload, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { NetworkStatus } from '@/components/network-status';
import { NAV_ITEMS } from '@/components/layout/app-sidebar';

interface AppHeaderProps {
  activeTab: string;
  currentUser: { seniorityNumber?: number } | null | undefined;
  seniorityPercentile: number | string | null | undefined;
  onUpload: () => void;
  onOpenAI: () => void;
}

export function AppHeader({
  activeTab,
  currentUser,
  seniorityPercentile,
  onUpload,
  onOpenAI,
}: AppHeaderProps) {
  const title =
    NAV_ITEMS.find(item => item.value === activeTab)?.label ?? 'Dashboard';

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:px-4">
      <SidebarTrigger aria-label="Toggle sidebar" />
      <Separator orientation="vertical" className="mr-1 h-5" />
      <h1 className="text-title truncate">{title}</h1>
      {currentUser?.seniorityNumber ? (
        <Badge variant="outline" className="hidden text-xs sm:inline-flex">
          Seniority #{currentUser.seniorityNumber}
          {seniorityPercentile !== null && seniorityPercentile !== undefined
            ? ` (${seniorityPercentile}%)`
            : ''}
        </Badge>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenAI}
          className="gap-1.5"
          data-testid="header-ai-assistant"
        >
          <Bot className="h-4 w-4" />
          <span className="hidden sm:inline">AI Assistant</span>
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={onUpload}
          className="gap-1.5"
          data-testid="header-upload"
        >
          <CloudUpload className="h-4 w-4" />
          <span className="hidden sm:inline">Upload package</span>
        </Button>
        <NetworkStatus />
      </div>
    </header>
  );
}
