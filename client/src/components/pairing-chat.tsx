import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, Bot, User, Loader2, Trash2 } from "lucide-react";
import { api } from "@/lib/api";

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  data?: any;
}

interface PairingChatProps {
  bidPackageId?: number;
}

export function PairingChat({ bidPackageId }: PairingChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
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
  }, []);

  // Load chat history when session ID is available
  useEffect(() => {
    if (sessionId) {
      loadChatHistory();
    }
  }, [sessionId]);

  const loadChatHistory = async () => {
    try {
      const history = await api.getChatHistory(sessionId);
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
        await api.saveChatMessage({
          sessionId,
          bidPackageId,
          messageType: 'assistant',
          content: welcomeMessage.content
        });
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
      }
    } catch (error) {
      console.error('Failed to load chat history:', error);
      // Show welcome message on error
      const welcomeMessage: ChatMessage = {
        id: '1',
        type: 'assistant',
        content: 'Hi! I can help you analyze your pairing data. Try asking me things like:\n\n• "What are the 10 longest layovers in DFW?"\n• "Show me 4-day pairings with high hold probability"\n• "Which pairings have the best credit-to-block ratio?"\n• "Find pairings with layovers over 12 hours"',
        timestamp: new Date()
      };
      setMessages([welcomeMessage]);
    }
  };

  const clearChat = async () => {
    try {
      await api.clearChatHistory(sessionId);
      // Generate new session ID
      const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('chatSessionId', newSessionId);
      setSessionId(newSessionId);
      // Reset to welcome message
      const welcomeMessage: ChatMessage = {
        id: '1',
        type: 'assistant',
        content: 'Hi! I can help you analyze your pairing data. Try asking me things like:\n\n• "What are the 10 longest layovers in DFW?"\n• "Show me 4-day pairings with high hold probability"\n• "Which pairings have the best credit-to-block ratio?"\n• "Find pairings with layovers over 12 hours"',
        timestamp: new Date()
      };
      setMessages([welcomeMessage]);
      await api.saveChatMessage({
        sessionId: newSessionId,
        bidPackageId,
        messageType: 'assistant',
        content: welcomeMessage.content
      });
    } catch (error) {
      console.error('Failed to clear chat history:', error);
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
    } catch (error) {
      console.error('Failed to save user message:', error);
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
      } catch (saveError) {
        console.error('Failed to save assistant message:', saveError);
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
      } catch (saveError) {
        console.error('Failed to save error message:', saveError);
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

  return (
    <Card className="h-[600px] flex flex-col">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Bot className="h-5 w-5 text-blue-600" />
            <span>Pairing Analysis Assistant</span>
            {bidPackageId && (
              <Badge variant="secondary" className="text-xs">
                Analyzing Bid Package #{bidPackageId}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearChat}
            title="Clear chat history"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
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
                    <div className="whitespace-pre-wrap text-sm">
                      {message.content}
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

          {!bidPackageId && (
            <div className="mt-2 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
              Upload a bid package to enable full analysis capabilities
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}