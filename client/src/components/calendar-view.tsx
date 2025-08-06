import React, { useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';

type CalendarEvent = {
  id: number;
  userId: number;
  pairingId: number;
  startDate: string;
  endDate: string;
  notes?: string;
  pairing: {
    id: number;
    pairingNumber: string;
    route: string;
    creditHours: string;
    blockHours: string;
    tafb: string;
    checkInTime?: string;
  };
};

type CalendarViewProps = {
  userId: number;
};

export function CalendarView({ userId }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const queryClient = useQueryClient();
  
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Fetch calendar events for current month
  const { data: events = [], isLoading } = useQuery<CalendarEvent[]>({
    queryKey: ['calendar', userId, currentDate.getMonth() + 1, currentDate.getFullYear()],
    queryFn: async () => {
      const response = await fetch(`/api/calendar/${userId}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}`);
      if (!response.ok) throw new Error('Failed to fetch calendar events');
      return response.json();
    },
  });

  // Remove from calendar mutation
  const removeFromCalendarMutation = useMutation({
    mutationFn: async ({ userId, pairingId }: { userId: number; pairingId: number }) => {
      const response = await fetch('/api/calendar', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, pairingId }),
      });
      if (!response.ok) throw new Error('Failed to remove from calendar');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar', userId] });
      toast({ title: 'Success', description: 'Pairing removed from calendar' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to remove pairing from calendar', variant: 'destructive' });
    },
  });

  const getEventsForDay = (date: Date): CalendarEvent[] => {
    return events.filter(event => {
      const eventStart = new Date(event.startDate);
      const eventEnd = new Date(event.endDate);
      return date >= eventStart && date <= eventEnd;
    });
  };

  const handleRemoveFromCalendar = (pairingId: number) => {
    removeFromCalendarMutation.mutate({ userId, pairingId });
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => direction === 'next' ? addMonths(prev, 1) : subMonths(prev, 1));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Bid Calendar - {format(currentDate, 'MMMM yyyy')}</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigateMonth('prev')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigateMonth('next')}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {/* Day headers */}
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="p-2 text-center text-sm font-medium text-gray-500 border-b">
                {day}
              </div>
            ))}
            
            {/* Calendar days */}
            {calendarDays.map(day => {
              const dayEvents = getEventsForDay(day);
              const isCurrentMonth = isSameMonth(day, currentDate);
              const isToday = isSameDay(day, new Date());
              
              return (
                <div
                  key={day.toISOString()}
                  className={`min-h-[100px] p-1 border border-gray-100 ${
                    !isCurrentMonth ? 'bg-gray-50 text-gray-400' : 'bg-white'
                  } ${isToday ? 'bg-blue-50 border-blue-200' : ''}`}
                >
                  <div className={`text-sm mb-1 ${isToday ? 'font-bold text-blue-600' : ''}`}>
                    {format(day, 'd')}
                  </div>
                  
                  {dayEvents.map(event => (
                    <div
                      key={event.id}
                      className="mb-1 p-1 bg-blue-100 rounded text-xs hover:bg-blue-200 group relative"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {event.pairing.pairingNumber}
                          </div>
                          <div className="text-gray-600 truncate">
                            {event.pairing.creditHours}cr
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100 h-5 w-5 p-0 hover:bg-red-100"
                          onClick={() => handleRemoveFromCalendar(event.pairingId)}
                          disabled={removeFromCalendarMutation.isPending}
                        >
                          <Trash2 className="h-3 w-3 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        
        {events.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-medium mb-3">Calendar Summary</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="bg-blue-50 p-3 rounded">
                <div className="font-medium">Total Pairings</div>
                <div className="text-2xl font-bold text-blue-600">{events.length}</div>
              </div>
              <div className="bg-green-50 p-3 rounded">
                <div className="font-medium">Total Credit Hours</div>
                <div className="text-2xl font-bold text-green-600">
                  {events.reduce((sum, event) => sum + parseFloat(event.pairing.creditHours), 0).toFixed(2)}
                </div>
              </div>
              <div className="bg-purple-50 p-3 rounded">
                <div className="font-medium">Total Block Hours</div>
                <div className="text-2xl font-bold text-purple-600">
                  {events.reduce((sum, event) => sum + parseFloat(event.pairing.blockHours), 0).toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}