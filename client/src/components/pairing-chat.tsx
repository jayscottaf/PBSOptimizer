import { useState, useRef, useEffect, Fragment } from 'react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Send,
  Bot,
  User,
  Loader2,
  Plus,
  MessageSquare,
  X,
  Upload,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { BidPackage } from '@/lib/api';
import { PairingDisplay } from './pairing-display';
import { useQuery } from '@tanstack/react-query';
interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  data?: any;
}

interface ConversationSummary {
  sessionId: string;
  title: string;
  lastMessage: string;
  lastActivity: Date;
  messageCount: number;
}

interface PairingChatProps {
  bidPackageId?: number;
  compact?: boolean; // For mobile optimization
}

export function PairingChat({
  bidPackageId,
  compact = false,
}: PairingChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [showConversations, setShowConversations] = useState(false);
  const [currentBidPackage, setCurrentBidPackage] = useState<BidPackage | null>(
    null
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Check if we have any bid packages available
  const { data: bidPackages = [] } = useQuery({
    queryKey: ['/api/bid-packages'],
    queryFn: () => api.getBidPackages(),
    staleTime: 0, // Always fetch fresh data
    refetchOnMount: true,
  });

  const hasBidPackages = bidPackages.length > 0;
  const hasCompletedBidPackages = bidPackages.some(
    pkg => pkg.status === 'completed'
  );

  // Generate or retrieve session ID
  useEffect(() => {
    const storedSessionId = localStorage.getItem('chatSessionId');
    if (storedSessionId) {
      setSessionId(storedSessionId);
    } else {
      const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('chatSessionId', newSessionId);
      setSessionId(newSessionId);
    }
    loadConversationList();
  }, []);

  // Load chat history when session ID is available
  useEffect(() => {
    if (sessionId) {
      loadChatHistory();
    }
  }, [sessionId]);

  // Load current bid package data
  useEffect(() => {
    const loadCurrentBidPackage = async () => {
      if (bidPackageId) {
        try {
          const bidPackages = await api.getBidPackages();
          const currentPackage = bidPackages.find(
            pkg => pkg.id === bidPackageId
          );
          setCurrentBidPackage(currentPackage || null);
        } catch (error) {
          console.error('Failed to load current bid package:', error);
        }
      }
    };

    loadCurrentBidPackage();
  }, [bidPackageId]);

  const loadConversationList = async () => {
    try {
      // Get all stored session IDs from localStorage
      const storedSessions = JSON.parse(
        localStorage.getItem('conversationSessions') || '[]'
      );
      const conversationSummaries: ConversationSummary[] = [];

      for (const storedSessionId of storedSessions) {
        try {
          const history = await api.getChatHistory(storedSessionId);
          if (history.length > 0) {
            const lastMessage = history[history.length - 1];
            const firstUserMessage = history.find(
              (msg: any) => msg.messageType === 'user'
            );

            conversationSummaries.push({
              sessionId: storedSessionId,
              title: firstUserMessage
                ? firstUserMessage.content.substring(0, 50) +
                  (firstUserMessage.content.length > 50 ? '...' : '')
                : 'New Conversation',
              lastMessage:
                lastMessage.content.substring(0, 100) +
                (lastMessage.content.length > 100 ? '...' : ''),
              lastActivity: new Date(lastMessage.createdAt),
              messageCount: history.length,
            });
          }
        } catch (error) {
          console.error(
            `Failed to load conversation ${storedSessionId}:`,
            error
          );
        }
      }

      // Sort by last activity, most recent first
      conversationSummaries.sort(
        (a, b) => b.lastActivity.getTime() - a.lastActivity.getTime()
      );
      setConversations(conversationSummaries);
    } catch (error) {
      console.error('Failed to load conversation list:', error);
    }
  };

  const saveSessionToList = (sessionId: string) => {
    const storedSessions = JSON.parse(
      localStorage.getItem('conversationSessions') || '[]'
    );
    if (!storedSessions.includes(sessionId)) {
      storedSessions.unshift(sessionId);
      // Keep only last 50 conversations
      const limitedSessions = storedSessions.slice(0, 50);
      localStorage.setItem(
        'conversationSessions',
        JSON.stringify(limitedSessions)
      );
    }
  };

  const loadChatHistory = async () => {
    try {
      console.log('Loading chat history for session:', sessionId);
      const history = await api.getChatHistory(sessionId);
      console.log('Chat history loaded:', history.length, 'messages');

      if (history.length === 0) {
        // Add welcome message if no history exists
        const welcomeMessage: ChatMessage = {
          id: '1',
          type: 'assistant',
          content:
            'Hi! I can help you analyze your pairing data. Try asking me things like:\n\n• "Show me 4-day pairings"\n• "Find pairings to Seattle with high hold probability"\n• "Which pairings have the best credit-to-block ratio?"\n• "What are the most efficient pairings for junior pilots?"',
          timestamp: new Date(),
        };
        setMessages([welcomeMessage]);

        // Save welcome message to database
        try {
          await api.saveChatMessage({
            sessionId,
            bidPackageId,
            messageType: 'assistant',
            content: welcomeMessage.content,
          });
          console.log('Welcome message saved successfully');
          saveSessionToList(sessionId);
        } catch (saveError: unknown) {
          console.error(
            'Failed to save welcome message:',
            saveError instanceof Error ? saveError.message : String(saveError)
          );
        }
      } else {
        // Convert database history to chat messages
        const chatMessages: ChatMessage[] = history.map((msg: any) => ({
          id: msg.id.toString(),
          type: msg.messageType as 'user' | 'assistant',
          content: msg.content,
          timestamp: new Date(msg.createdAt),
          data: msg.messageData,
        }));
        setMessages(chatMessages);
        console.log('Chat messages loaded and set in state');
        saveSessionToList(sessionId);
      }
    } catch (error) {
      console.error('Failed to load chat history:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message, error.stack);
      }
      // Show welcome message on error
      const welcomeMessage: ChatMessage = {
        id: '1',
        type: 'assistant',
        content:
          'Chat history temporarily unavailable. Hi! I can help you analyze your pairing data. Try asking me things like:\n\n• "Show me 4-day pairings"\n• "Find pairings to Seattle with high hold probability"\n• "Which pairings have the best credit-to-block ratio?"\n• "What are the most efficient pairings for junior pilots?"',
        timestamp: new Date(),
      };
      setMessages([welcomeMessage]);
    }
  };

  const startNewConversation = async () => {
    try {
      // Generate new session ID
      const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('chatSessionId', newSessionId);
      setSessionId(newSessionId);

      // Clear current messages
      setMessages([]);

      // Reload conversation list to include the old session
      await loadConversationList();

      console.log('Started new conversation with session:', newSessionId);
    } catch (error) {
      console.error('Failed to start new conversation:', error);
    }
  };

  const loadConversation = async (selectedSessionId: string) => {
    try {
      localStorage.setItem('chatSessionId', selectedSessionId);
      setSessionId(selectedSessionId);
      setShowConversations(false);
      console.log('Switched to conversation:', selectedSessionId);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !sessionId) {
      return;
    }

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Save user message to database
    try {
      await api.saveChatMessage({
        sessionId,
        bidPackageId,
        messageType: 'user',
        content: userMessage.content,
      });
      console.log('User message saved successfully');
      saveSessionToList(sessionId);
    } catch (error: unknown) {
      console.error(
        'Failed to save user message:',
        error,
        error instanceof Error ? error.message : String(error)
      );
    }

    try {
      const result = await api.analyzePairings(
        input.trim(),
        bidPackageId,
        sessionId
      );

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: result.response,
        timestamp: new Date(),
        data: result.data,
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Save assistant message to database
      try {
        await api.saveChatMessage({
          sessionId,
          bidPackageId,
          messageType: 'assistant',
          content: assistantMessage.content,
          messageData: assistantMessage.data,
        });
        console.log('Assistant message saved successfully');
        // Reload conversation list to update the last message
        await loadConversationList();
      } catch (saveError: unknown) {
        console.error(
          'Failed to save assistant message:',
          saveError,
          saveError instanceof Error ? saveError.message : String(saveError)
        );
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content:
          'Sorry, I encountered an error while analyzing your request. Please make sure you have uploaded a bid package and try again.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);

      // Save error message to database
      try {
        await api.saveChatMessage({
          sessionId,
          bidPackageId,
          messageType: 'assistant',
          content: errorMessage.content,
        });
        console.log('Error message saved successfully');
      } catch (saveError: unknown) {
        console.error(
          'Failed to save error message:',
          saveError,
          saveError instanceof Error ? saveError.message : String(saveError)
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatRelativeTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const isPlaceholderPackageValue = (value?: string | null) =>
    !value || value.trim().toUpperCase() === 'PENDING';

  const formatBidPackageLabel = (bidPackage: BidPackage) => {
    const parts = [
      !isPlaceholderPackageValue(bidPackage.base) ? bidPackage.base : null,
      !isPlaceholderPackageValue(bidPackage.aircraft)
        ? bidPackage.aircraft
        : null,
      bidPackage.month,
    ].filter(Boolean);

    return `${parts.join(' ')} Bid Package`;
  };

  const parsePairingsFromMessage = (content: string, messageData?: any) => {
    const pairings = [];

    // Extract pairings from various locations in message data
    if (messageData?.pairings && Array.isArray(messageData.pairings)) {
      pairings.push(...messageData.pairings);
    }

    if (messageData?.pairing) {
      pairings.push(messageData.pairing);
    }

    // Extract from topPairings if it's an efficiency analysis
    if (messageData?.topPairings && Array.isArray(messageData.topPairings)) {
      pairings.push(...messageData.topPairings);
    }

    // Extract from data array if present
    if (messageData?.data && Array.isArray(messageData.data)) {
      pairings.push(...messageData.data);
    }

    // Convert any pairing objects to have consistent structure
    return pairings.map(pairing => ({
      pairingNumber: pairing.pairingNumber || pairing.pairing_number,
      route: pairing.route,
      creditHours: pairing.creditHours || pairing.credit_hours,
      blockHours: pairing.blockHours || pairing.block_hours,
      tafb: pairing.tafb,
      pairingDays: pairing.pairingDays || pairing.pairing_days,
      holdProbability: pairing.holdProbability || pairing.hold_probability,
      layovers: pairing.layovers,
      effectiveDates: pairing.effectiveDates || pairing.effective_dates,
      payHours: pairing.payHours || pairing.pay_hours,
      fullText: pairing.fullText || pairing.full_text,
      fullTextBlock:
        pairing.fullTextBlock ||
        pairing.full_text_block ||
        pairing.fullText ||
        pairing.full_text,
    }));
  };

  const formatMessageWithPairings = (content: string, messageData?: any) => {
    const pairings = parsePairingsFromMessage(content, messageData);

    // Create a map of pairing numbers to pairing objects for quick lookup
    const pairingMap = new Map();
    pairings.forEach(pairing => {
      if (pairing.pairingNumber) {
        pairingMap.set(pairing.pairingNumber.toString(), pairing);
      }
    });

    const renderInline = (text: string, keyPrefix: string): ReactNode[] => {
      const nodes: ReactNode[] = [];
      const boldPattern = /(\*\*[^*]+\*\*)/g;
      let boldIndex = 0;
      let segmentIndex = 0;
      let boldMatch;

      const pushPairingAwareText = (segment: string, prefix: string) => {
        const pairingPattern = /\b(\d{4,5})\b/g;
        let lastIndex = 0;
        let match;
        let tokenIndex = 0;

        while ((match = pairingPattern.exec(segment)) !== null) {
          const pairingNumber = match[1];
          const pairing = pairingMap.get(pairingNumber);

          if (!pairing) {
            continue;
          }

          if (match.index > lastIndex) {
            nodes.push(
              <Fragment key={`${prefix}-text-${tokenIndex++}`}>
                {segment.substring(lastIndex, match.index)}
              </Fragment>
            );
          }

          nodes.push(
            <PairingDisplay
              key={`${prefix}-pairing-${tokenIndex++}-${pairingNumber}`}
              pairing={pairing}
              displayText={pairingNumber}
            />
          );

          lastIndex = match.index + match[0].length;
        }

        if (lastIndex < segment.length) {
          nodes.push(
            <Fragment key={`${prefix}-text-${tokenIndex++}`}>
              {segment.substring(lastIndex)}
            </Fragment>
          );
        }
      };

      while ((boldMatch = boldPattern.exec(text)) !== null) {
        if (boldMatch.index > boldIndex) {
          pushPairingAwareText(
            text.substring(boldIndex, boldMatch.index),
            `${keyPrefix}-${segmentIndex++}`
          );
        }

        const boldText = boldMatch[0].slice(2, -2);
        nodes.push(
          <strong
            key={`${keyPrefix}-bold-${segmentIndex++}`}
            className="font-semibold text-slate-50"
          >
            {renderInline(boldText, `${keyPrefix}-bold-inner-${segmentIndex}`)}
          </strong>
        );
        boldIndex = boldMatch.index + boldMatch[0].length;
      }

      if (boldIndex < text.length) {
        pushPairingAwareText(
          text.substring(boldIndex),
          `${keyPrefix}-${segmentIndex++}`
        );
      }

      return nodes.length > 0 ? nodes : [text];
    };

    const renderTable = (tableLines: string[], key: string) => {
      const rows = tableLines
        .map(line =>
          line
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map(cell => cell.trim())
        )
        .filter(row => row.some(Boolean));

      const header = rows[0] || [];
      const bodyRows = rows
        .slice(1)
        .filter(row => !row.every(cell => /^:?-{3,}:?$/.test(cell)));

      return (
        <div
          key={key}
          className="my-4 max-w-full overflow-x-auto rounded-md border border-slate-700"
        >
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-200">
              <tr>
                {header.map((cell, index) => (
                  <th
                    key={`${key}-head-${index}`}
                    className="whitespace-nowrap px-3 py-2 font-semibold"
                  >
                    {renderInline(cell, `${key}-head-${index}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-950/60">
              {bodyRows.map((row, rowIndex) => (
                <tr key={`${key}-row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${key}-cell-${rowIndex}-${cellIndex}`}
                      className="align-top px-3 py-2 text-slate-300"
                    >
                      {renderInline(
                        cell,
                        `${key}-cell-${rowIndex}-${cellIndex}`
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    };

    const renderMarkdown = () => {
      const lines = content.split('\n');
      const blocks: ReactNode[] = [];
      let index = 0;

      while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();
        const key = `block-${index}`;

        if (!trimmed) {
          index += 1;
          continue;
        }

        if (trimmed.startsWith('```')) {
          const codeLines = [];
          index += 1;
          while (
            index < lines.length &&
            !lines[index].trim().startsWith('```')
          ) {
            codeLines.push(lines[index]);
            index += 1;
          }
          index += 1;
          blocks.push(
            <pre
              key={key}
              className="my-4 max-w-full overflow-x-auto rounded-md border border-slate-700 bg-slate-950 p-3 text-xs leading-relaxed text-slate-100"
            >
              <code>{codeLines.join('\n')}</code>
            </pre>
          );
          continue;
        }

        if (
          trimmed.startsWith('|') &&
          index + 1 < lines.length &&
          /^\s*\|?[\s:|-]+\|[\s:|-]+\|?\s*$/.test(lines[index + 1])
        ) {
          const tableLines = [];
          while (index < lines.length && lines[index].trim().startsWith('|')) {
            tableLines.push(lines[index]);
            index += 1;
          }
          blocks.push(renderTable(tableLines, key));
          continue;
        }

        const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const headingClass =
            level <= 2
              ? 'mt-5 mb-2 text-base font-semibold text-slate-50'
              : 'mt-4 mb-2 text-sm font-semibold text-slate-100';
          blocks.push(
            <div key={key} className={headingClass}>
              {renderInline(headingMatch[2], `${key}-heading`)}
            </div>
          );
          index += 1;
          continue;
        }

        if (/^[-*•]\s+/.test(trimmed)) {
          const items = [];
          while (
            index < lines.length &&
            /^[-*•]\s+/.test(lines[index].trim())
          ) {
            items.push(lines[index].trim().replace(/^[-*•]\s+/, ''));
            index += 1;
          }
          blocks.push(
            <ul
              key={key}
              className="my-3 list-disc space-y-1.5 pl-5 text-sm text-slate-300"
            >
              {items.map((item, itemIndex) => (
                <li key={`${key}-item-${itemIndex}`}>
                  {renderInline(item, `${key}-item-${itemIndex}`)}
                </li>
              ))}
            </ul>
          );
          continue;
        }

        const paragraphLines = [trimmed];
        index += 1;
        while (
          index < lines.length &&
          lines[index].trim() &&
          !lines[index].trim().startsWith('```') &&
          !lines[index].trim().startsWith('|') &&
          !/^(#{1,4})\s+/.test(lines[index].trim()) &&
          !/^[-*•]\s+/.test(lines[index].trim())
        ) {
          paragraphLines.push(lines[index].trim());
          index += 1;
        }

        blocks.push(
          <p key={key} className="my-2 text-sm leading-7 text-slate-300">
            {renderInline(paragraphLines.join(' '), `${key}-paragraph`)}
          </p>
        );
      }

      return blocks;
    };

    return <div className="space-y-1">{renderMarkdown()}</div>;
  };

  return (
    <div className="flex h-full">
      {/* Conversation Sidebar - Hidden in compact mode */}
      {!compact && showConversations && (
        <Card className="w-80 mr-4 flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between">
              <span className="text-sm">Conversations</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowConversations(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-2">
            <div className="space-y-2">
              {conversations.map(conv => (
                <Button
                  key={conv.sessionId}
                  variant={conv.sessionId === sessionId ? 'secondary' : 'ghost'}
                  className="w-full justify-start h-auto p-3 text-left"
                  onClick={() => loadConversation(conv.sessionId)}
                >
                  <div className="flex flex-col items-start w-full">
                    <div className="font-medium text-sm truncate w-full">
                      {conv.title}
                    </div>
                    <div className="text-xs text-gray-500 truncate w-full">
                      {conv.lastMessage}
                    </div>
                    <div className="text-xs text-gray-400">
                      {formatRelativeTime(conv.lastActivity)} •{' '}
                      {conv.messageCount} messages
                    </div>
                  </div>
                </Button>
              ))}
              {conversations.length === 0 && (
                <div className="text-center text-gray-500 text-sm py-8">
                  No conversations yet
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Chat Interface */}
      <Card className="flex-1 flex flex-col min-h-0 bg-slate-950/80 border-slate-800">
        <CardHeader className="pb-4 flex-shrink-0">
          <CardTitle className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Bot className="h-5 w-5 text-blue-500 flex-shrink-0" />
              <span className="leading-tight">Pairing Analysis Assistant</span>
              {currentBidPackage && (
                <Badge
                  variant="secondary"
                  className="max-w-full whitespace-normal rounded-full bg-slate-800 px-3 py-1 text-xs leading-snug text-slate-100"
                >
                  {formatBidPackageLabel(currentBidPackage)}
                </Badge>
              )}
            </div>
            <div className="flex items-center space-x-2">
              {!compact && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowConversations(!showConversations)}
                  title="Show conversations"
                >
                  <MessageSquare className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={startNewConversation}
                title="Start a new conversation"
                className={compact ? 'px-2' : ''}
              >
                <Plus className="h-4 w-4" />
                {!compact && 'New Conversation'}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col p-0 min-h-0">
          {/* Messages */}
          <div
            className={`flex-1 overflow-y-auto space-y-4 pb-28 pt-1 ${compact ? 'px-3' : 'px-4'}`}
          >
            {messages.map(message => (
              <div
                key={message.id}
                className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`rounded-lg px-4 py-3 ${
                    message.type === 'user'
                      ? 'max-w-[85%] bg-blue-600 text-white'
                      : `${compact ? 'max-w-[96%]' : 'max-w-[90%]'} border border-slate-800 bg-slate-900 text-slate-100 shadow-sm`
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {message.type === 'assistant' && (
                      <Bot className="h-4 w-4 mt-1 text-blue-400 flex-shrink-0" />
                    )}
                    {message.type === 'user' && (
                      <User className="h-4 w-4 mt-0.5 text-white flex-shrink-0" />
                    )}
                    <div className="flex-1">
                      <div>
                        {message.type === 'assistant' ? (
                          formatMessageWithPairings(
                            message.content,
                            message.data
                          )
                        ) : (
                          <span className="whitespace-pre-wrap text-sm">
                            {message.content}
                          </span>
                        )}
                      </div>
                      <div
                        className={`text-xs mt-1 ${
                          message.type === 'user'
                            ? 'text-blue-200'
                            : 'text-slate-500'
                        }`}
                      >
                        {formatTimestamp(message.timestamp)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-2">
                  <div className="flex items-center space-x-2">
                    <Bot className="h-4 w-4 text-blue-400" />
                    <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                    <span className="text-sm text-slate-300">Analyzing...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div
            className={`border-t border-slate-800 flex-shrink-0 bg-slate-950 ${compact ? 'p-2' : 'p-4'}`}
          >
            <form onSubmit={handleSubmit} className="flex space-x-2">
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask about your pairings..."
                className="flex-1"
                disabled={isLoading}
              />
              <Button
                type="submit"
                disabled={isLoading || !input.trim()}
                size="icon"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>

            {!hasCompletedBidPackages ? (
              <div
                className={`text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded ${compact ? 'mt-1' : 'mt-2'}`}
              >
                {bidPackages.length === 0
                  ? 'Upload a bid package to start using the AI assistant'
                  : 'Processing bid package... AI assistant will be available once processing is complete'}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
