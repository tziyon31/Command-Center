import React, { useState, useEffect, useRef } from 'react';
import { api as base44 } from '@/api/apiClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import MessageBubble from '../components/chat/MessageBubble.jsx';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Plus, Sparkles, Loader2 } from 'lucide-react';

export default function Assistant() {
  const [input, setInput] = useState('');
  const [currentConversation, setCurrentConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef(null);
  const queryClient = useQueryClient();

  // יצירת שיחה חדשה
  const createConversation = async () => {
    const conv = await base44.agents.createConversation({
      agent_name: "business_assistant",
      metadata: {
        name: "שיחה חדשה",
        description: "עוזר ניהול עסק"
      }
    });
    setCurrentConversation(conv);
    setMessages([]);
    return conv;
  };

  // התחלת שיחה בטעינה ראשונה
  useEffect(() => {
    createConversation();
  }, []);

  // הרשמה לעדכונים
  useEffect(() => {
    if (!currentConversation?.id) return;

    const unsubscribe = base44.agents.subscribeToConversation(
      currentConversation.id,
      (data) => {
        setMessages(data.messages || []);
        // בדיקה אם יש הודעה שעדיין מעובדת
        const hasProcessing = data.messages?.some(msg => 
          msg.tool_calls?.some(tc => ['pending', 'running', 'in_progress'].includes(tc.status))
        );
        setIsProcessing(hasProcessing);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [currentConversation?.id]);

  // גלילה אוטומטית למטה
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !currentConversation || isProcessing) return;

    const messageText = input.trim();
    setInput('');
    setIsProcessing(true);

    try {
      await base44.agents.addMessage(currentConversation, {
        role: 'user',
        content: messageText
      });
    } catch (error) {
      console.error('Error sending message:', error);
      setIsProcessing(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1000px] mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">עוזר AI</h1>
              <p className="text-sm text-muted-foreground">שאל אותי כל דבר על העסק שלך</p>
            </div>
          </div>
          <Button variant="outline" onClick={createConversation}>
            <Plus className="w-4 h-4 ml-2" />
            שיחה חדשה
          </Button>
        </div>

        {/* Chat Area */}
        <Card className="h-[calc(100vh-240px)] flex flex-col">
          <CardContent className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center space-y-4">
                  <div className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="w-10 h-10 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">שלום! איך אוכל לעזור?</h3>
                    <p className="text-sm text-muted-foreground mt-2">
                      תוכל לבקש ממני ליצור לקוחות, פרויקטים, הצעות מחיר, לעדכן משימות ועוד
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl mx-auto mt-6">
                    <Button
                      variant="outline"
                      className="text-right justify-start h-auto py-3 px-4"
                      onClick={() => setInput('צור לי 3 לקוחות דוגמה')}
                    >
                      <span className="text-sm">צור לי 3 לקוחות דוגמה</span>
                    </Button>
                    <Button
                      variant="outline"
                      className="text-right justify-start h-auto py-3 px-4"
                      onClick={() => setInput('הראה לי את כל הפרויקטים הפעילים')}
                    >
                      <span className="text-sm">הראה לי את כל הפרויקטים הפעילים</span>
                    </Button>
                    <Button
                      variant="outline"
                      className="text-right justify-start h-auto py-3 px-4"
                      onClick={() => setInput('צור משימה חדשה לתיאום פגישה עם לקוח')}
                    >
                      <span className="text-sm">צור משימה לתיאום פגישה</span>
                    </Button>
                    <Button
                      variant="outline"
                      className="text-right justify-start h-auto py-3 px-4"
                      onClick={() => setInput('מה הסטטוס של החשבוניות הפתוחות?')}
                    >
                      <span className="text-sm">מה הסטטוס של החשבוניות?</span>
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, idx) => (
                  <MessageBubble key={idx} message={msg} />
                ))}
                <div ref={messagesEndRef} />
              </>
            )}
          </CardContent>

          {/* Input Area */}
          <div className="border-t p-4">
            <div className="flex gap-3">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="הקלד הודעה... (Enter לשליחה, Shift+Enter לשורה חדשה)"
                className="resize-none"
                rows={2}
                disabled={isProcessing}
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isProcessing}
                size="lg"
                className="px-6"
              >
                {isProcessing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </Button>
            </div>
            {isProcessing && (
              <p className="text-xs text-muted-foreground mt-2 text-center">
                העוזר מעבד את הבקשה...
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}