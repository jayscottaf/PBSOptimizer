import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, Bot, User, Loader2, Plus, MessageSquare, X } from "lucide-react";
import { api } from "@/lib/api";
import type { BidPackage } from "@/lib/api";
import { PairingDisplay } from "./pairing-display";

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
}

export function PairingChat({ bidPackageId }: PairingChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [showConversations, setShowConversations] = useState(false);
  const [currentBidPackage, setCurrentBidPackage] = useState<BidPackage | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
          const currentPackage = bidPackages.find(pkg => pkg.id === bidPackageId);
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
      const storedSessions = JSON.parse(localStorage.getItem('conversationSessions') || '[]');
      const conversationSummaries: ConversationSummary[] = [];

      for (const storedSessionId of storedSessions) {
        try {
          const history = await api.getChatHistory(storedSessionId);
          if (history.length > 0) {
            const lastMessage = history[history.length - 1];
            const firstUserMessage = history.find(msg => msg.messageType === 'user');

            conversationSummaries.push({
              sessionId: storedSessionId,
              title: firstUserMessage ? 
                firstUserMessage.content.substring(0, 50) + (firstUserMessage.content.length > 50 ? '...' : '') :
                'New Conversation',
              lastMessage: lastMessage.content.substring(0, 100) + (lastMessage.content.length > 100 ? '...' : ''),
              lastActivity: new Date(lastMessage.createdAt),
              messageCount: history.length
            });
          }
        } catch (error) {
          console.error(`Failed to load conversation ${storedSessionId}:`, error);
        }
      }

      // Sort by last activity, most recent first
      conversationSummaries.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
      setConversations(conversationSummaries);
    } catch (error) {
      console.error('Failed to load conversation list:', error);
    }
  };

  const saveSessionToList = (sessionId: string) => {
    const storedSessions = JSON.parse(localStorage.getItem('conversationSessions') || '[]');
    if (!storedSessions.includes(sessionId)) {
      storedSessions.unshift(sessionId);
      // Keep only last 50 conversations
      const limitedSessions = storedSessions.slice(0, 50);
      localStorage.setItem('conversationSessions', JSON.stringify(limitedSessions));
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
          content: 'Hi! I can help you analyze your pairing data. Try asking me things like:\n\n• "What are the 10 longest layovers in DFW?"\n• "Show me 4-day pairings with high hold probability"\n• "Which pairings have the best credit-to-block ratio?"\n• "Find pairings with layovers over 12 hours"',
          timestamp: new Date()
        };
        setMessages([welcomeMessage]);

        // Save welcome message to database
        try {
          await api.saveChatMessage({
            sessionId,
            bidPackageId,
            messageType: 'assistant',
            content: welcomeMessage.content
          });
          console.log('Welcome message saved successfully');
          saveSessionToList(sessionId);
        } catch (saveError) {
          console.error('Failed to save welcome message:', saveError);
        }
      } else {
        // Convert database history to chat messages
        const chatMessages: ChatMessage[] = history.map((msg) => ({
          id: msg.id.toString(),
          type: msg.messageType as 'user' | 'assistant',
          content: msg.content,
          timestamp: new Date(msg.createdAt),
          data: msg.messageData
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
        content: 'Chat history temporarily unavailable. Hi! I can help you analyze your pairing data. Try asking me things like:\n\n• "What are the 10 longest layovers in DFW?"\n• "Show me 4-day pairings with high hold probability"\n• "Which pairings have the best credit-to-block ratio?"\n• "Find pairings with layovers over 12 hours"',
        timestamp: new Date()
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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !sessionId) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: input.trim(),
      timestamp: new Date()
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
        content: userMessage.content
      });
      console.log('User message saved successfully');
      saveSessionToList(sessionId);
    } catch (error) {
      console.error('Failed to save user message:', error, error.message || error);
    }

    try {
      const result = await api.analyzePairings(input.trim(), bidPackageId);

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: result.response,
        timestamp: new Date(),
        data: result.data
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Save assistant message to database
      try {
        await api.saveChatMessage({
          sessionId,
          bidPackageId,
          messageType: 'assistant',
          content: assistantMessage.content,
          messageData: assistantMessage.data
        });
        console.log('Assistant message saved successfully');
        // Reload conversation list to update the last message
        await loadConversationList();
      } catch (saveError) {
        console.error('Failed to save assistant message:', saveError, saveError.message || saveError);
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: 'Sorry, I encountered an error while analyzing your request. Please make sure you have uploaded a bid package and try again.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);

      // Save error message to database
      try {
        await api.saveChatMessage({
          sessionId,
          bidPackageId,
          messageType: 'assistant',
          content: errorMessage.content
        });
        console.log('Error message saved successfully');
      } catch (saveError) {
        console.error('Failed to save error message:', saveError, saveError.message || saveError);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
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
      fullTextBlock: pairing.fullTextBlock || pairing.full_text_block || pairing.fullText || pairing.full_text
    }));
  };

  const formatMessageWithPairings = (content: string, messageData?: any) => {
    const pairings = parsePairingsFromMessage(content, messageData);

    if (pairings.length === 0) {
      return <span className="whitespace-pre-wrap text-sm">{content}</span>;
    }

    // Create a map of pairing numbers to pairing objects for quick lookup
    const pairingMap = new Map();
    pairings.forEach(pairing => {
      if (pairing.pairingNumber) {
        pairingMap.set(pairing.pairingNumber.toString(), pairing);
      }
    });

    // Split content and replace pairing numbers with interactive elements
    const parts = [];
    let remainingContent = content;

    // Enhanced regex patterns to catch various pairing number formats
    const pairingPatterns = [
      // "Pairing number: 8161" format
      /(?:pairing\s+number\s*:\s*)(\d{4,5})/gi,
      // "Pairing 8161" format  
      /(?:pairing\s+)(\d{4,5})(?!\d)/gi,
      // "pairing number 8161" format
      /(?:pairing\s+number\s+)(\d{4,5})(?!\d)/gi,
      // Numbered list format: "1. Pairing number: 8161"
      /(?:\d+\.\s*pairing\s+number\s*:\s*)(\d{4,5})/gi,
      // Hash format: "#8161"
      /#(\d{4,5})(?!\d)/gi
    ];

    let processedContent = remainingContent;
    let globalOffset = 0;

    // Process each pattern
    for (const pattern of pairingPatterns) {
      pattern.lastIndex = 0; // Reset regex
      let match;

      while ((match = pattern.exec(processedContent)) !== null) {
        const pairingNumber = match[1];
        const pairing = pairingMap.get(pairingNumber);

        if (pairing) {
          const matchStart = match.index + match[0].indexOf(pairingNumber);
          const matchEnd = matchStart + pairingNumber.length;

          // Add text before the match
          if (matchStart > 0) {
            parts.push(processedContent.slice(0, matchStart));
          }

          // Add the PairingDisplay component
          parts.push(
            <PairingDisplay 
              key={`pairing-${pairingNumber}-${matchStart}-${globalOffset}`}
              pairing={pairing}
              displayText={pairingNumber}
            />
          );

          // Update processed content to continue after this match
          processedContent = processedContent.slice(matchEnd);
          globalOffset += matchEnd;
          pattern.lastIndex = 0; // Reset for new content
          break; // Process one match at a time to avoid index issues
        }
      }
    }

    // Add any remaining content
    if (processedContent.length > 0) {
      parts.push(processedContent);
    }

    return parts.length > 0 ? (
      <div className="whitespace-pre-wrap text-sm">{parts}</div>
    ) : (
      <span className="whitespace-pre-wrap text-sm">{content}</span>
    );
  };

  return (
    <div className="flex h-[600px]">
      {/* Conversation Sidebar */}
      {showConversations && (
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
              {conversations.map((conv) => (
                <Button
                  key={conv.sessionId}
                  variant={conv.sessionId === sessionId ? "secondary" : "ghost"}
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
                      {formatRelativeTime(conv.lastActivity)} • {conv.messageCount} messages
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
      <Card className="flex-1 flex flex-col">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Bot className="h-5 w-5 text-blue-600" />
              <span>Pairing Analysis Assistant</span>
              {currentBidPackage && (
                <Badge variant="secondary" className="text-xs">
                  {currentBidPackage.base} {currentBidPackage.aircraft} {currentBidPackage.month} Bid Package
                </Badge>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowConversations(!showConversations)}
                title="Show conversations"
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={startNewConversation}
                title="Start a new conversation"
              >
                <Plus className="h-4 w-4" />
                New Conversation
              </Button>
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col p-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    message.type === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <div className="flex items-start space-x-2">
                    {message.type === 'assistant' && (
                      <Bot className="h-4 w-4 mt-0.5 text-blue-600 flex-shrink-0" />
                    )}
                    {message.type === 'user' && (
                      <User className="h-4 w-4 mt-0.5 text-white flex-shrink-0" />
                    )}
                    <div className="flex-1">
                      <div>
                        {message.type === 'assistant' 
                          ? formatMessageWithPairings(message.content, message.data)
                          : <span className="whitespace-pre-wrap text-sm">{message.content}</span>
                        }
                      </div>
                      <div className={`text-xs mt-1 ${
                        message.type === 'user' ? 'text-blue-200' : 'text-gray-500'
                      }`}>
                        {formatTimestamp(message.timestamp)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-lg px-4 py-2">
                  <div className="flex items-center space-x-2">
                    <Bot className="h-4 w-4 text-blue-600" />
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    <span className="text-sm text-gray-600">Analyzing...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t p-4">
            <form onSubmit={handleSubmit} className="flex space-x-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
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

            {!currentBidPackage && (
              <div className="mt-2 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
                Upload a bid package to enable full analysis capabilities
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}