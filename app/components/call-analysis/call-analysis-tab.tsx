"use client";

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CalendarIcon, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CallAnalysisTable, PhoneCallAnalysis } from './call-analysis-table';
import { Phone, BarChart, PhoneForwarded, Clock } from 'lucide-react';

export function CallAnalysisTab() {
  // Initialize with today as the default date range
  const today = new Date();
  const [date, setDate] = useState<DateRange | undefined>({
    from: today,
    to: today
  });
  
  const [loading, setLoading] = useState<boolean>(false);
  const [data, setData] = useState<PhoneCallAnalysis[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    totalEmails: number;
    uniquePhones: number;
    mostFrequentCaller: {
      phoneNumber: string;
      callCount: number;
    } | null;
    earliestCall: Date | null;
    latestCall: Date | null;
  }>({
    totalEmails: 0,
    uniquePhones: 0,
    mostFrequentCaller: null,
    earliestCall: null,
    latestCall: null
  });

  const fetchData = async () => {
    if (!date?.from || !date?.to) return;

    setLoading(true);
    setError(null);

    try {
      const fromDate = format(date.from, 'yyyy-MM-dd');
      const toDate = format(date.to || date.from, 'yyyy-MM-dd');
      
      const response = await fetch(`/api/call-analysis?from=${fromDate}&to=${toDate}`);
      const result = await response.json();
      
      if (response.ok) {
        setData(result.data || []);
        
        // Calculate stats
        const totalEmails = result.data.reduce((sum: number, item: PhoneCallAnalysis) => sum + item.emails.length, 0);
        const uniquePhones = result.data.length;
        
        // Find most frequent caller
        let mostFrequentCaller = null;
        if (result.data.length > 0) {
          mostFrequentCaller = [...result.data].sort((a, b) => b.callCount - a.callCount)[0];
        }
        
        // Find earliest and latest call dates
        let earliestCall = null;
        let latestCall = null;
        
        if (result.data.length > 0) {
          const allDates = result.data.flatMap((item: PhoneCallAnalysis) => 
            item.emails.map(email => new Date(email.received_date))
          );
          
          if (allDates.length > 0) {
            earliestCall = new Date(Math.min(...allDates.map((d: Date) => d.getTime())));
            latestCall = new Date(Math.max(...allDates.map((d: Date) => d.getTime())));
          }
        }
        
        setStats({
          totalEmails,
          uniquePhones,
          mostFrequentCaller: mostFrequentCaller ? {
            phoneNumber: mostFrequentCaller.phoneNumber,
            callCount: mostFrequentCaller.callCount
          } : null,
          earliestCall,
          latestCall
        });
      } else {
        setError(result.error || 'Veri alınamadı');
        setData([]);
      }
    } catch (error) {
      console.error('Error fetching call analysis:', error);
      setError('Veri alınırken bir hata oluştu');
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch data when component mounts or date changes
  useEffect(() => {
    fetchData();
  }, [date]);

  const formatDateRange = (from: Date, to: Date) => {
    if (from && to) {
      return `${format(from, "d MMMM", { locale: tr })} - ${format(to, "d MMMM", { locale: tr })}`;
    } else if (from) {
      return format(from, "d MMMM", { locale: tr });
    } else {
      return 'Tarih seçin';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                id="date"
                variant={"outline"}
                className={cn(
                  "w-[300px] justify-start text-left font-normal",
                  !date && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date?.from ? (
                  date.to ? (
                    <>
                      {formatDateRange(date.from, date.to)}
                    </>
                  ) : (
                    formatDateRange(date.from, date.from)
                  )
                ) : (
                  <span>Tarih seçin</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={date?.from}
                selected={date}
                onSelect={setDate}
                numberOfMonths={2}
                locale={tr}
              />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="icon" onClick={fetchData} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 w-full">
          {/* Total Emails Card */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-2 pt-4 px-5 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/30 border-b">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/20">
                  <Phone className="h-4 w-4 text-blue-600" />
                </div>
                <CardTitle className="text-base font-medium text-blue-900/80 dark:text-blue-100">Toplam E-posta</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-5 py-4">
              <div className="text-2xl font-bold">{stats.totalEmails}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {date && date.from ? formatDateRange(date.from, date.to || date.from) : ''}
              </p>
            </CardContent>
          </Card>

          {/* Unique Phone Numbers Card */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-2 pt-4 px-5 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/30 border-b">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/20">
                  <BarChart className="h-4 w-4 text-purple-600" />
                </div>
                <CardTitle className="text-base font-medium text-purple-900/80 dark:text-purple-100">Farklı Telefon Sayısı</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-5 py-4">
              <div className="text-2xl font-bold">{stats.uniquePhones}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.uniquePhones > 0 
                  ? `${((stats.uniquePhones / stats.totalEmails) * 100).toFixed(1)}% benzersiz` 
                  : 'Veri yok'}
              </p>
            </CardContent>
          </Card>

          {/* Most Frequent Caller Card */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-2 pt-4 px-5 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/30 border-b">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-500/20">
                  <PhoneForwarded className="h-4 w-4 text-green-600" />
                </div>
                <CardTitle className="text-base font-medium text-green-900/80 dark:text-green-100">En Sık Arayan</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-5 py-4">
              <div className="text-lg font-bold truncate">
                {stats.mostFrequentCaller ? stats.mostFrequentCaller.phoneNumber : 'Veri yok'}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.mostFrequentCaller 
                  ? `${stats.mostFrequentCaller.callCount} arama (${((stats.mostFrequentCaller.callCount / stats.totalEmails) * 100).toFixed(1)}%)` 
                  : 'Veri yok'}
              </p>
            </CardContent>
          </Card>

          {/* Latest Call Card */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-2 pt-4 px-5 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/20 dark:to-amber-800/30 border-b">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-500/20">
                  <Clock className="h-4 w-4 text-amber-600" />
                </div>
                <CardTitle className="text-base font-medium text-amber-900/80 dark:text-amber-100">Son Arama</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-5 py-4">
              <div className="text-lg font-medium">
                {stats.latestCall ? format(stats.latestCall, 'dd MMM yyyy, HH:mm', { locale: tr }) : 'Veri yok'}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.latestCall ? 'Veri yok' : 'Veri yok'}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {error ? (
        <div className="rounded-md bg-red-50 p-4 my-4">
          <div className="flex">
            <div className="text-red-700">
              <p className="text-sm">{error}</p>
            </div>
          </div>
        </div>
      ) : (
        <CallAnalysisTable 
          data={data} 
          startDate={date?.from} 
          endDate={date?.to || date?.from} 
        />
      )}
    </div>
  );
}
