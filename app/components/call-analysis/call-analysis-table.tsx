"use client";

import React, { useState, useEffect } from 'react';
import { BarChart, Search, Phone, MailOpen, Clock, ChevronDown, ChevronUp, ExternalLink, PhoneOff, ChevronRight, Info, List, Download, FileSpreadsheet } from 'lucide-react';
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

export interface PhoneCallAnalysis {
  phoneNumber: string;
  callCount: number;
  emails: {
    id: number;
    subject: string;
    received_date: string;
    from_address: string;
  }[];
}

interface CallAnalysisTableProps {
  data: PhoneCallAnalysis[];
  loading: boolean;
  startDate: Date | undefined;
  endDate: Date | undefined;
}

export function CallAnalysisTable({ 
  data,
  loading,
  startDate,
  endDate
}: CallAnalysisTableProps) {
  const [filterValue, setFilterValue] = useState('');
  const [sortValue, setSortValue] = useState('callCount-desc');
  const [expandedPhones, setExpandedPhones] = useState<string[]>([]);
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
        'İlk Arama': new Date(item.emails[item.emails.length-1].received_date).toLocaleDateString('tr-TR'),
        'Son Arama': new Date(item.emails[0].received_date).toLocaleDateString('tr-TR')
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
  
  // Filter by search term
  const filteredData = data.filter(item => 
    item.phoneNumber.includes(filterValue) || 
    item.emails.some(email => email.subject.toLowerCase().includes(filterValue.toLowerCase()))
  );
  
  // Sort data
  const sortedData = [...filteredData].sort((a, b) => {
    if (sortValue === 'callCount-desc') {
      return b.callCount - a.callCount;
    } else if (sortValue === 'callCount-asc') {
      return a.callCount - b.callCount;
    } else if (sortValue === 'lastCall-desc') {
      return new Date(b.emails[0].received_date) - new Date(a.emails[0].received_date);
    } else if (sortValue === 'lastCall-asc') {
      return new Date(a.emails[0].received_date) - new Date(b.emails[0].received_date);
    }
  });

  const toggleExpandRow = (phoneNumber: string) => {
    if (expandedPhones.includes(phoneNumber)) {
      setExpandedPhones(expandedPhones.filter(p => p !== phoneNumber));
    } else {
      setExpandedPhones([...expandedPhones, phoneNumber]);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-32">
        <div className="flex flex-col items-center gap-4">
          <BarChart className="h-8 w-8 animate-pulse text-primary" />
          <p className="text-sm text-muted-foreground">Analiz yükleniyor...</p>
        </div>
      </div>
    );
  }

  if (sortedData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <PhoneOff className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-lg font-medium text-muted-foreground">Sonuç bulunamadı</p>
        <p className="text-sm text-muted-foreground/80">
          {startDate && endDate ? 
            'Seçili tarih aralığında birden fazla kez arayan numara bulunmamaktadır.' : 
            'Lütfen bir tarih aralığı seçin ve Analiz Et butonuna tıklayın.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Çoklu Arama Analizi</h2>
        </div>
        {data.length > 0 && (
          <div className="flex items-center gap-2">
            <Input
              placeholder="Telefon numarası ara..."
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
              className="w-64"
            />
            <Select value={sortValue} onValueChange={setSortValue}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Sıralama" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="callCount-desc">Arama Sayısı: Yüksek → Düşük</SelectItem>
                <SelectItem value="callCount-asc">Arama Sayısı: Düşük → Yüksek</SelectItem>
                <SelectItem value="lastCall-desc">Son Arama: Yeni → Eski</SelectItem>
                <SelectItem value="lastCall-asc">Son Arama: Eski → Yeni</SelectItem>
              </SelectContent>
            </Select>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={exportToExcel} 
              className="ml-2 bg-green-50 hover:bg-green-100 text-green-600 hover:text-green-700 border-green-200"
              disabled={!xlsxLoaded}
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              {xlsxLoaded ? 'Excel\'e Aktar' : 'Excel Yükleniyor...'}
            </Button>
          </div>
        )}
      </div>

      <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead></TableHead>
              <TableHead className="font-medium">Telefon Numarası</TableHead>
              <TableHead className="font-medium">Arama Sayısı</TableHead>
              <TableHead className="font-medium text-right">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  {data.length === 0 ? (
                    <div className="flex flex-col items-center gap-2">
                      <PhoneOff className="h-8 w-8 text-muted-foreground/50" />
                      <p>Seçilen tarih aralığında çoklu arama bulunamadı.</p>
                    </div>
                  ) : (
                    <div>Arama kriterinize uygun sonuç bulunamadı.</div>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              sortedData.map((item, index) => (
                <React.Fragment key={item.phoneNumber}>
                  <TableRow className={cn(
                    "cursor-pointer hover:bg-muted/30", 
                    {
                      "bg-muted/20": expandedPhones.includes(item.phoneNumber)
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
                        {expandedPhones.includes(item.phoneNumber) ? (
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
                          {new Date(item.emails[0].received_date).toLocaleDateString('tr-TR')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={(e) => {
                        e.stopPropagation();
                        toggleExpandRow(item.phoneNumber);
                      }}>
                        {expandedPhones.includes(item.phoneNumber) ? "Gizle" : "Detaylar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expandedPhones.includes(item.phoneNumber) && (
                    <TableRow className={cn(
                      "bg-muted/5",
                      index % 2 === 0 ? "bg-white" : "bg-gray-50"
                    )}>
                      <TableCell colSpan={4} className="p-0 border-b border-b-muted">
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
                                      {new Date(item.emails[item.emails.length-1].received_date).toLocaleDateString('tr-TR')}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center pb-2 border-b border-muted">
                                    <span className="text-muted-foreground text-sm">Son Arama:</span>
                                    <span className="text-sm">
                                      {new Date(item.emails[0].received_date).toLocaleDateString('tr-TR')}
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
                                    <TableCell className="align-top">
                                      <div className="space-y-2">
                                        <div className="font-medium break-words whitespace-normal">
                                          {email.subject}
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                          {email.subject.match(/#\+9[0-9]{10,12}#/) && (
                                            <div className="flex items-center gap-2 mt-1">
                                              <Phone className="h-3.5 w-3.5 text-primary" />
                                              <span>{email.subject.match(/#\+9[0-9]{10,12}#/)?.[0]}</span>
                                            </div>
                                          )}
                                          
                                          {email.subject.match(/\((\d+) Kez\)/) && (
                                            <div className="flex items-center gap-2 mt-1">
                                              <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full">
                                                {email.subject.match(/\((\d+) Kez\)/)?.[1]} Kez Aranmış
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
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
      </div>
    </div>
  );
}
