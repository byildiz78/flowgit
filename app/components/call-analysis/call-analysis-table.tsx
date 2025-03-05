"use client";

import React, { useState, useEffect } from 'react';
import { BarChart, Search, Phone, MailOpen, Clock, ChevronDown, ChevronUp, ExternalLink, PhoneOff, ChevronRight, Info, List, Download, FileSpreadsheet, Eye, RefreshCw } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  Select,
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { encodeEmailId } from "@/lib/emailIdEncoder";

export interface PhoneCallAnalysis {
  phoneNumber: string;
  callCount: number;
  lastDate: string;
  firstDate: string;
  emails: Email[];
}

export interface Email {
  id: number;
  subject: string;
  from_address: string;
  received_date: string;
}

interface CallAnalysisTableProps {
  data: PhoneCallAnalysis[];
  startDate?: Date;
  endDate?: Date;
}

export function CallAnalysisTable({ 
  data,
  startDate,
  endDate
}: CallAnalysisTableProps) {
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortValue, setSortValue] = useState<string>('callCount-desc');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [filterValue, setFilterValue] = useState('');
  const [xlsxLoaded, setXlsxLoaded] = useState(false);
  const [xlsxModule, setXlsxModule] = useState<any>(null);

  // Dynamically load XLSX module on client side only
  useEffect(() => {
    if (typeof window !== 'undefined' && !xlsxLoaded) {
      import('xlsx').then(xlsx => {
        setXlsxModule(xlsx);
        setXlsxLoaded(true);
      }).catch(err => {
        console.error('Failed to load XLSX module:', err);
      });
    }
  }, [xlsxLoaded]);
  
  // Function to export data to Excel (XLSX format)
  const exportToExcel = () => {
    if (data.length === 0 || !xlsxLoaded || !xlsxModule) {
      if (!xlsxLoaded) {
        alert('Excel modülü yükleniyor, lütfen bekleyin...');
      }
      return;
    }
    
    try {
      const XLSX = xlsxModule;
      
      // Create a new workbook
      const wb = XLSX.utils.book_new();
      
      // Generate data for the summary sheet (phone number grouped)
      const summaryData = sortedData.map(item => ({
        'Telefon Numarası': item.phoneNumber,
        'Arama Sayısı': item.callCount,
        'İlk Arama': item.firstDate,
        'Son Arama': item.lastDate
      }));
      
      // Create summary worksheet
      const summaryWs = XLSX.utils.json_to_sheet(summaryData);
      
      // Set column widths for better readability
      const summaryColWidths = [
        { wch: 20 }, // Telefon Numarası
        { wch: 15 }, // Arama Sayısı
        { wch: 15 }, // İlk Arama
        { wch: 15 }  // Son Arama
      ];
      
      summaryWs['!cols'] = summaryColWidths;
      
      // Add the summary sheet to the workbook
      XLSX.utils.book_append_sheet(wb, summaryWs, 'Özet');
      
      // Create a details worksheet for each phone number
      sortedData.forEach(item => {
        // Format the call data for this phone number
        const detailsData = item.emails.map(email => ({
          'Tarih': new Date(email.received_date).toLocaleDateString('tr-TR'),
          'Saat': new Date(email.received_date).toLocaleTimeString('tr-TR'),
          'Konu': email.subject || '',
          'Gönderen': email.from_address || ''
        }));
        
        // Create worksheet for this phone
        const detailsWs = XLSX.utils.json_to_sheet(detailsData);
        
        // Set column widths for better readability
        const detailsColWidths = [
          { wch: 15 }, // Tarih
          { wch: 15 }, // Saat
          { wch: 50 }, // Konu
          { wch: 30 }  // Gönderen
        ];
        
        detailsWs['!cols'] = detailsColWidths;
        
        // Add a title for the phone number at the top
        XLSX.utils.sheet_add_aoa(detailsWs, [[`${item.phoneNumber} (${item.callCount} arama)`]], { origin: "A1" });
        
        // Make the title cell bold and merge cells
        if (!detailsWs['!merges']) detailsWs['!merges'] = [];
        detailsWs['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } });
        
        // Add the details sheet to the workbook
        const sheetName = item.phoneNumber.replace(/\+/g, '');
        XLSX.utils.book_append_sheet(wb, detailsWs, sheetName);
      });
      
      // Generate file name
      let fileName = 'arama-analizi';
      if (startDate && endDate) {
        fileName += `_${startDate.toLocaleDateString('tr-TR').replace(/\//g, '-')}-${endDate.toLocaleDateString('tr-TR').replace(/\//g, '-')}`;
      }
      fileName += '.xlsx';
      
      // Write the workbook and trigger download
      XLSX.writeFile(wb, fileName);
      
    } catch (error) {
      console.error('Excel export error:', error);
      alert('Excel\'e aktarma sırasında bir hata oluştu.');
    }
  };
  
  // Sort data
  const sortedData = [...data].sort((a, b) => {
    if (sortValue === 'callCount-desc') {
      return b.callCount - a.callCount;
    } else if (sortValue === 'callCount-asc') {
      return a.callCount - b.callCount;
    } else if (sortValue === 'lastCall-desc') {
      return new Date(b.lastDate).getTime() - new Date(a.lastDate).getTime();
    } else if (sortValue === 'lastCall-asc') {
      return new Date(a.lastDate).getTime() - new Date(b.lastDate).getTime();
    }
    // Default case to ensure a number is always returned
    return 0;
  });
  
  // Filter by search term
  const filteredData = sortedData.filter(item => {
    // If no search query, return all data
    if (!searchQuery) return true;
    
    // Check if phone number includes search query
    if (item.phoneNumber.toLowerCase().includes(searchQuery.toLowerCase())) return true;
    
    // Check if any email in this phone number includes search query in subject or sender
    return item.emails.some(email => 
      email.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.from_address.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const paginatedData = filteredData.slice((page - 1) * itemsPerPage, page * itemsPerPage);
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  const toggleExpandRow = (phoneNumber: string) => {
    if (expandedRows[phoneNumber]) {
      setExpandedRows({ ...expandedRows, [phoneNumber]: false });
    } else {
      setExpandedRows({ ...expandedRows, [phoneNumber]: true });
    }
  };

  if (startDate === undefined && endDate === undefined) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <PhoneOff className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-lg font-medium text-muted-foreground">Lütfen bir tarih aralığı seçin ve Analiz Et butonuna tıklayın.</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <PhoneOff className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-lg font-medium text-muted-foreground">Sonuç bulunamadı</p>
        <p className="text-sm text-muted-foreground/80">
          Seçili tarih aralığında birden fazla kez arayan numara bulunmamaktadır.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Telefon numarası veya konu ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64"
          />
          <Select value={sortValue} onValueChange={setSortValue}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Sıralama" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="callCount-desc">Arama Sayısı (Çok {'>'} Az)</SelectItem>
              <SelectItem value="callCount-asc">Arama Sayısı (Az {'>'} Çok)</SelectItem>
              <SelectItem value="lastCall-desc">Son Arama (Yeni {'>'} Eski)</SelectItem>
              <SelectItem value="lastCall-asc">Son Arama (Eski {'>'} Yeni)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                className="gap-1"
                onClick={exportToExcel}
                disabled={isExporting}
              >
                {isExporting ? (
                  <>
                    <span className="animate-spin mr-1">
                      <RefreshCw className="h-4 w-4" />
                    </span>
                    <span>Dışa Aktarılıyor...</span>
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="h-4 w-4 mr-1" />
                    <span>Excel'e Aktar</span>
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Tüm verileri Excel dosyasına aktar</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-14"></TableHead>
              <TableHead>Telefon Numarası</TableHead>
              <TableHead className="text-center">Arama Sayısı</TableHead>
              <TableHead>Son Arama</TableHead>
              <TableHead className="text-right">İşlem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-48 text-center">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <PhoneOff className="h-8 w-8 text-muted-foreground/50" />
                    <p className="text-lg font-medium text-muted-foreground">Arama bulunamadı</p>
                    <p className="text-sm text-muted-foreground/80">
                      {searchQuery 
                        ? 'Arama kriterinize uygun sonuç bulunamadı.' 
                        : 'Seçili tarih aralığında arama bulunmamaktadır.'}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((item, index) => (
                <React.Fragment key={item.phoneNumber}>
                  <TableRow className={cn(
                    "cursor-pointer hover:bg-muted/30", 
                    {
                      "bg-muted/20": expandedRows[item.phoneNumber]
                    },
                    index % 2 === 0 ? "bg-white" : "bg-gray-50"
                  )}>
                    <TableCell className="w-10">
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpandRow(item.phoneNumber);
                        }}
                        className="h-8 w-8"
                      >
                        {expandedRows[item.phoneNumber] ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell onClick={() => toggleExpandRow(item.phoneNumber)}>
                      <div className="flex items-center gap-2">
                        <div className="bg-primary/10 p-1.5 rounded-full">
                          <Phone className="h-4 w-4 text-primary" />
                        </div>
                        <span className="font-medium">{item.phoneNumber}</span>
                      </div>
                    </TableCell>
                    <TableCell onClick={() => toggleExpandRow(item.phoneNumber)}>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="bg-primary/10 hover:bg-primary/20 text-primary border-none">
                          {item.callCount} kez
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {item.lastDate}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={(e) => {
                        e.stopPropagation();
                        toggleExpandRow(item.phoneNumber);
                      }}>
                        {expandedRows[item.phoneNumber] ? "Gizle" : "Detaylar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expandedRows[item.phoneNumber] && (
                    <TableRow className={cn(
                      "bg-muted/5",
                      index % 2 === 0 ? "bg-white" : "bg-gray-50"
                    )}>
                      <TableCell colSpan={5} className="p-0 border-b border-b-muted">
                        <div className="p-6 space-y-6">
                          <div className="flex gap-4">
                            <div className="flex-1">
                              <div className="p-4 border rounded-md bg-muted/10 backdrop-blur-sm shadow-sm">
                                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                  <Clock className="h-4 w-4 text-primary" />
                                  Arama Zamanları
                                </h3>
                                <div className="h-40 flex items-end gap-1">
                                  {item.emails.map((email, i) => {
                                    const date = new Date(email.received_date);
                                    const hour = date.getHours();
                                    const getColorClass = () => {
                                      if (hour < 9) return "bg-blue-500 hover:bg-blue-600"; // Morning
                                      if (hour < 12) return "bg-green-500 hover:bg-green-600"; // Late morning
                                      if (hour < 15) return "bg-yellow-500 hover:bg-yellow-600"; // Afternoon
                                      if (hour < 18) return "bg-orange-500 hover:bg-orange-600"; // Late afternoon
                                      return "bg-purple-500 hover:bg-purple-600"; // Evening
                                    };
                                    const height = Math.max(30, Math.min(100, 100 - (hour - 8) * 5));
                                    
                                    return (
                                      <div 
                                        key={i} 
                                        className={cn(
                                          "relative w-6 rounded-t-md flex items-center justify-center text-[10px] text-white font-bold cursor-pointer group transition-all",
                                          getColorClass()
                                        )}
                                        style={{ height: `${height}%` }}
                                        title={`${new Date(email.received_date).toLocaleString('tr-TR')}`}
                                      >
                                        {hour}
                                        <div className="absolute bottom-full mb-2 bg-black/90 text-white p-2 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-md">
                                          {new Date(email.received_date).toLocaleString('tr-TR')}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>

                            <div className="w-72 shrink-0">
                              <div className="p-4 border rounded-md bg-muted/10 backdrop-blur-sm shadow-sm h-full">
                                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                                  <Info className="h-4 w-4 text-primary" />
                                  Arama Özeti
                                </h3>
                                <div className="space-y-3">
                                  <div className="flex justify-between items-center pb-2 border-b border-muted">
                                    <span className="text-muted-foreground text-sm">Telefon Numarası:</span>
                                    <span className="font-medium">{item.phoneNumber}</span>
                                  </div>
                                  <div className="flex justify-between items-center pb-2 border-b border-muted">
                                    <span className="text-muted-foreground text-sm">Toplam Arama:</span>
                                    <Badge variant="outline" className="bg-primary/5 text-primary">
                                      {item.callCount} kez
                                    </Badge>
                                  </div>
                                  <div className="flex justify-between items-center pb-2 border-b border-muted">
                                    <span className="text-muted-foreground text-sm">İlk Arama:</span>
                                    <span className="text-sm">
                                      {item.firstDate}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center pb-2 border-b border-muted">
                                    <span className="text-muted-foreground text-sm">Son Arama:</span>
                                    <span className="text-sm">
                                      {item.lastDate}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="border rounded-md shadow-sm overflow-hidden bg-white">
                            <div className="bg-muted/20 px-4 py-3 border-b">
                              <h3 className="font-medium flex items-center gap-2">
                                <List className="h-4 w-4 text-primary" />
                                Tüm Aramalar ({item.emails.length})
                              </h3>
                            </div>
                            <Table>
                              <TableHeader className="bg-muted/5">
                                <TableRow>
                                  <TableHead className="w-52">Tarih ve Saat</TableHead>
                                  <TableHead>Konu</TableHead>
                                  <TableHead className="w-20 text-right">İşlem</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {item.emails.map((email, emailIndex) => (
                                  <TableRow 
                                    key={email.id} 
                                    className={cn(
                                      "hover:bg-muted/5",
                                      emailIndex % 2 === 0 ? "bg-white" : "bg-gray-50"
                                    )}
                                  >
                                    <TableCell className="align-top w-52">
                                      <div className="flex flex-col">
                                        <span className="font-medium">{new Date(email.received_date).toLocaleDateString('tr-TR')}</span>
                                        <span className="text-sm text-muted-foreground">{new Date(email.received_date).toLocaleTimeString('tr-TR')}</span>
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex flex-col">
                                        <div className="font-medium">{email.subject}</div>
                                        <span className="text-sm text-muted-foreground mt-1">{email.from_address}</span>
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-8 w-8"
                                              onClick={() => {
                                                const encodedId = encodeEmailId(email.id);
                                                window.open(`/email/${encodedId}`, '_blank');
                                              }}
                                            >
                                              <Eye className="h-4 w-4 text-blue-600" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent side="left">
                                            <p>E-posta Detayını Görüntüle</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between py-4 px-2 border-t">
          <div className="flex-1 text-sm text-muted-foreground">
            Toplam <span className="font-medium">{filteredData.length}</span> arama kaydı | 
            <span className="font-medium"> {(page - 1) * itemsPerPage + 1}-{Math.min(page * itemsPerPage, filteredData.length)}</span> gösteriliyor
          </div>
          <div className="flex items-center space-x-6 lg:space-x-8">
            <div className="flex items-center space-x-2">
              <p className="text-sm font-medium">Sayfa başına</p>
              <Select
                value={itemsPerPage.toString()}
                onValueChange={(value) => {
                  setPage(1);
                  setItemsPerPage(parseInt(value));
                }}
              >
                <SelectTrigger className="h-8 w-[70px]">
                  <SelectValue placeholder={itemsPerPage.toString()} />
                </SelectTrigger>
                <SelectContent side="top">
                  {[5, 10, 20, 50].map((pageSize) => (
                    <SelectItem key={pageSize} value={pageSize.toString()}>
                      {pageSize}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-[100px] items-center justify-center text-sm font-medium">
              Sayfa {page} / {totalPages === 0 ? 1 : totalPages}
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => setPage(1)}
                disabled={page === 1}
              >
                <span className="sr-only">İlk sayfa</span>
                <ChevronDown className="h-4 w-4 rotate-90" />
              </Button>
              <Button
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => setPage(page > 1 ? page - 1 : 1)}
                disabled={page === 1}
              >
                <span className="sr-only">Önceki sayfa</span>
                <ChevronDown className="h-4 w-4 rotate-180" />
              </Button>
              <Button
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => setPage(page < totalPages ? page + 1 : totalPages)}
                disabled={page === totalPages || totalPages === 0}
              >
                <span className="sr-only">Sonraki sayfa</span>
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages || totalPages === 0}
              >
                <span className="sr-only">Son sayfa</span>
                <ChevronDown className="h-4 w-4 -rotate-90" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
