"use client";

import { useState, useEffect } from 'react';
import { BarChart, AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { DateRangePicker } from './date-range-picker';
import { CallAnalysisTable, PhoneCallAnalysis } from './call-analysis-table';

interface CallAnalysisTabProps {
  // No props needed for now
}

export function CallAnalysisTab({}: CallAnalysisTabProps) {
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PhoneCallAnalysis[]>([]);
  const { toast } = useToast();

  const fetchAnalysisData = async () => {
    if (!startDate || !endDate) {
      toast({
        title: "Tarih seçimi eksik",
        description: "Başlangıç ve bitiş tarihlerini seçmelisiniz",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Format dates for API
      const formattedStartDate = startDate.toISOString().split('T')[0];
      const formattedEndDate = endDate.toISOString().split('T')[0];

      const response = await fetch(`/api/call-analysis?startDate=${formattedStartDate}&endDate=${formattedEndDate}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.message || "Analiz verileri alınamadı");
      }

      const analysisData = await response.json();
      setData(analysisData);
    } catch (error) {
      console.error("Call analysis error:", error);
      const errorMessage = error instanceof Error ? error.message : "Analiz verileri alınamadı";
      setError(errorMessage);
      toast({
        title: "Hata",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-none shadow-xl bg-white/80 backdrop-blur-sm dark:bg-gray-800/80">
        <CardHeader className="bg-white dark:bg-gray-800">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg">
              <BarChart className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Arama Analizi</CardTitle>
              <CardDescription>Tekrarlayan aramaları analiz edin ve takip edin</CardDescription>
            </div>
          </div>
          <div className="mt-4">
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
              onApply={fetchAnalysisData}
            />
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {error && (
            <Alert variant="destructive" className="mb-6 animate-in slide-in-from-top">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Hata</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <CallAnalysisTable 
            data={data}
            loading={loading}
            startDate={startDate}
            endDate={endDate}
          />
        </CardContent>
      </Card>
    </div>
  );
}
