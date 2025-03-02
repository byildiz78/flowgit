import { useState, useEffect } from "react";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { CalendarIcon, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { FlowAnalysisTable } from "./flow-analysis-table";
import { DateRange } from "react-day-picker";

interface FlowItem {
  id: string;
  title: string;
  stageId: string;
  opened: string;
  createdTime: string;
  ufCrm6_1735552809?: string; // Phone field
  companyId?: string;
}

interface StatsData {
  totalItems: number;
  newStatus: number;
  successStatus: number;
}

export function FlowAnalysisTab() {
  // Initialize with today as the default date range
  const [date, setDate] = useState<DateRange | undefined>({
    from: new Date(),
    to: new Date(),
  });
  const [flowItems, setFlowItems] = useState<FlowItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<StatsData>({
    totalItems: 0,
    newStatus: 0,
    successStatus: 0
  });
  const { toast } = useToast();

  const fetchData = async () => {
    if (!date?.from) return;
    
    setLoading(true);
    try {
      const fromDate = format(date.from, 'yyyy-MM-dd');
      const toDate = format(date.to || date.from, 'yyyy-MM-dd');
      
      toast({
        title: "Veri Yükleniyor",
        description: "Flow verileri yükleniyor, lütfen bekleyin...",
        variant: "default"
      });
      
      // Get the statistics with basic API calls
      // These don't fetch all records, just the counts
      const [mainResponse, newStatusResponse, successStatusResponse] = await Promise.all([
        fetch(`/api/flow-analysis?from=${fromDate}&to=${toDate}`),
        fetch(`/api/flow-analysis?from=${fromDate}&to=${toDate}&status=DT1036_28:NEW`),
        fetch(`/api/flow-analysis?from=${fromDate}&to=${toDate}&status=DT1036_10:SUCCESS`)
      ]);
      
      const mainData = await mainResponse.json();
      const newStatusData = await newStatusResponse.json();
      const successStatusData = await successStatusResponse.json();
      
      // Now fetch all records for display
      const allItemsResponse = await fetch(`/api/flow-analysis?from=${fromDate}&to=${toDate}&fetchAll=true`);
      
      if (!allItemsResponse.ok) {
        throw new Error('Error fetching flow data');
      }
      
      const allItemsData = await allItemsResponse.json();
      
      // Get the items from the response
      const items = allItemsData.result?.items || [];
      // Get total from the correct location
      const totalCount = mainData.total || 0;
      
      setFlowItems(items);
      
      // Add a toast notification to show the number of records fetched
      if (totalCount > 0) {
        toast({
          title: "Veri Yüklendi",
          description: `${items.length} kayıt yüklendi (toplam: ${totalCount}).`,
          variant: "default"
        });
      } else {
        toast({
          title: "Veri Bulunamadı",
          description: "Seçilen tarih aralığında veri bulunamadı.",
          variant: "default"
        });
      }
      
      // Calculate statistics
      const newCount = newStatusData.total || 0;
      const successCount = successStatusData.total || 0;
      
      setStats({
        totalItems: totalCount,  // Use the total from API response
        newStatus: newCount,
        successStatus: successCount
      });
    } catch (error) {
      console.error('Error fetching flow data:', error);
      toast({
        title: "Hata",
        description: "Flow verileri alınırken bir hata oluştu.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (date?.from) {
      fetchData();
    }
  }, [date?.from, date?.to]);

  const formatDateRange = (from: Date | null, to: Date | null) => {
    if (from !== null && to !== null) {
      return `${format(from, "d MMMM", { locale: tr })} - ${format(to, "d MMMM", { locale: tr })}`;
    } else if (from !== null) {
      return format(from, "d MMMM", { locale: tr });
    } else {
      return 'Tarih seçin';
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Flow Analiz</h2>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={"outline"}
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !date?.from && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date?.from && date?.to ? (
                  <>
                    {formatDateRange(date.from, date.to)}
                  </>
                ) : date?.from ? (
                  formatDateRange(date.from, date.from)
                ) : (
                  <span>Tarih seçin</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
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
          <Button
            size="icon"
            variant="outline"
            onClick={() => {
              const today = new Date();
              setDate({
                from: today,
                to: today,
              });
            }}
          >
            <X className="h-4 w-4" />
          </Button>
          <Button onClick={fetchData} disabled={loading}>
            {loading ? "Yükleniyor..." : "Yenile"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Records */}
        <Card className="bg-gradient-to-r from-slate-50 to-slate-100">
          <CardHeader className="px-5 pb-3 pt-5">
            <CardTitle className="text-base font-medium">Toplam Flow Kaydı</CardTitle>
          </CardHeader>
          <CardContent className="px-5 py-4">
            <div className="text-2xl font-bold">{stats.totalItems}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {date?.from && date?.to ? formatDateRange(date.from, date.to) : date?.from ? formatDateRange(date.from, date.from) : 'Tarih seçin'}
            </p>
          </CardContent>
        </Card>

        {/* New Status */}
        <Card className="bg-gradient-to-r from-blue-50 to-blue-100">
          <CardHeader className="px-5 pb-3 pt-5">
            <CardTitle className="text-base font-medium">Açık Durumlar</CardTitle>
          </CardHeader>
          <CardContent className="px-5 py-4">
            <div className="text-2xl font-bold">{stats.newStatus}</div>
            <p className="text-xs text-muted-foreground mt-1">
              new
            </p>
          </CardContent>
        </Card>

        {/* Success Status */}
        <Card className="bg-gradient-to-r from-green-50 to-green-100">
          <CardHeader className="px-5 pb-3 pt-5">
            <CardTitle className="text-base font-medium">Kapalı Durumlar</CardTitle>
          </CardHeader>
          <CardContent className="px-5 py-4">
            <div className="text-2xl font-bold">{stats.successStatus}</div>
            <p className="text-xs text-muted-foreground mt-1">
              success
            </p>
          </CardContent>
        </Card>
      </div>

      {flowItems.length > 0 ? (
        <FlowAnalysisTable flowItems={flowItems} />
      ) : (
        <div className="flex flex-col items-center justify-center py-10">
          <Search className="h-10 w-10 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium">Seçilen tarih aralığında veri bulunamadı</h3>
          <p className="text-sm text-muted-foreground">Lütfen filtreleri değiştirerek tekrar deneyin.</p>
        </div>
      )}
    </div>
  );
}
