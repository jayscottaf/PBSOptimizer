import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { defineTerm } from '@/lib/glossary';

interface TermProps {
  /** Glossary key. Defaults to the rendered text. */
  term?: string;
  children: React.ReactNode;
}

/** Dotted-underline glossary tooltip. Falls back to plain text when the
 *  term has no definition, so it is always safe to wrap. */
export function Term({ term, children }: TermProps) {
  const key = term ?? (typeof children === 'string' ? children : '');
  const definition = key ? defineTerm(key) : undefined;
  if (!definition) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-muted-foreground/50 decoration-dotted underline-offset-2">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-sm">{definition}</TooltipContent>
    </Tooltip>
  );
}
