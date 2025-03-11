import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableCaption,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Info, Loader2 } from "lucide-react";

interface FlowItem {
  id: string;
  title: string;
  stageId: string;
  opened: string;
  createdTime: string;
  ufCrm6_1735552809?: string; // Phone field
  companyId?: string;
}

interface Pipeline {
  id: number;
  name: string;
  sort: number;
  isDefault: boolean;
}

interface Stage {
  id: string;
  statusId: string;
  name: string;
  entityId: string;
  color: string;
  pipelineId: number;
  pipelineName: string;
}

interface BitrixData {
  pipelines: Pipeline[];
  stages: Stage[];
  pipelineMap: Record<number, string>;
  debug?: any;
}

interface FlowAnalysisTableProps {
  flowItems: FlowItem[];
}

export function FlowAnalysisTable({ flowItems }: FlowAnalysisTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortColumn, setSortColumn] = useState("createdTime");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedItem, setSelectedItem] = useState<FlowItem | null>(null);
  const [bitrixData, setBitrixData] = useState<BitrixData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);

  // Fetch Bitrix pipeline and stage data
  useEffect(() => {
    const fetchBitrixData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/bitrix/pipelines');
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to fetch pipeline data: ${response.status} ${errorText}`);
        }
        const data = await response.json();
        setBitrixData(data);
        setDebugInfo(data.debug || {
          pipelineCount: data.pipelines?.length || 0,
          stageCount: data.stages?.length || 0,
          samplePipeline: data.pipelines?.[0] || null,
          sampleStage: data.stages?.[0] || null
        });
      } catch (err) {
        console.error('Error fetching Bitrix data:', err);
        setError(`Failed to load pipeline data: ${(err as Error).message}`);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBitrixData();
  }, []);

  // Filter items based on search term
  const filteredItems = flowItems.filter((item) => {
    const searchString = searchTerm.toLowerCase();
    return (
      (item.id?.toString().toLowerCase().includes(searchString) || false) ||
      (item.title?.toLowerCase().includes(searchString) || false) ||
      (item.ufCrm6_1735552809?.toLowerCase().includes(searchString) || false) ||
      (item.stageId?.toLowerCase().includes(searchString) || false)
    );
  });

  // Sort items based on column and direction
  const sortedItems = [...filteredItems].sort((a, b) => {
    if (sortColumn === "createdTime") {
      const dateA = new Date(a.createdTime).getTime();
      const dateB = new Date(b.createdTime).getTime();
      return sortDirection === "asc" ? dateA - dateB : dateB - dateA;
    } else if (sortColumn === "id") {
      const idA = parseInt(a.id || "0");
      const idB = parseInt(b.id || "0"); 
      return sortDirection === "asc" ? idA - idB : idB - idA;
    } else if (sortColumn === "title") {
      const titleA = a.title || "";
      const titleB = b.title || "";
      return sortDirection === "asc"
        ? titleA.localeCompare(titleB)
        : titleB.localeCompare(titleA);
    }
    return 0;
  });

  // Calculate pagination
  const totalPages = Math.ceil(sortedItems.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedItems = sortedItems.slice(startIndex, startIndex + pageSize);

  // Handle sort change
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // Format functions
  const formatDate = (dateString: string) => {
    if (!dateString) return "-";
    try {
      const date = new Date(dateString);
      return format(date, "dd.MM.yyyy HH:mm", { locale: tr });
    } catch (error) {
      return dateString;
    }
  };

  // Extract pipeline ID from stageId
  const extractPipelineId = (stageId: string): number | null => {
    if (!stageId) return null;
    
    // Handle plain text status
    if (stageId === "Başarılı" || stageId === "Atanmamış") {
      return 10; // Default pipeline ID
    }
    
    // Extract from format DT1036_XX:YYY
    const match = stageId.match(/DT1036_(\d+):/);
    if (match && match[1]) {
      return parseInt(match[1]);
    }
    
    return null;
  };

  // Get pipeline name from pipeline ID
  const getPipelineNameById = (pipelineId: number | null): string => {
    if (!bitrixData || !pipelineId) return 'Unknown Pipeline';
    
    return bitrixData.pipelineMap[pipelineId] || 'Unknown Pipeline';
  };

  // Get stage information from stageId
  const getStageInfo = (stageId: string) => {
    if (!bitrixData || !stageId) return null;

    // Special case for plain text statuses
    if (stageId === "Başarılı") {
      return {
        pipelineId: 10, // Default pipeline
        pipelineName: getPipelineNameById(10),
        stageName: 'Başarılı',
        stageColor: '#2ecc71' // Green
      };
    }
    
    if (stageId === "Atanmamış") {
      return {
        pipelineId: 10, // Default pipeline
        pipelineName: getPipelineNameById(10),
        stageName: 'Atanmamış',
        stageColor: '#39a8ef' // Blue
      };
    }
    
    // Extract pipeline ID and status ID
    const pipelineId = extractPipelineId(stageId);
    if (!pipelineId) return null;
    
    // Extract status ID (everything after the colon)
    const colonIndex = stageId.indexOf(':');
    if (colonIndex === -1) return null;
    
    const statusId = stageId.substring(colonIndex + 1);
    
    // Find matching stage
    const matchingStage = bitrixData.stages.find(stage => 
      stage.pipelineId === pipelineId && stage.statusId === statusId
    );
    
    if (matchingStage) {
      return {
        pipelineId,
        pipelineName: matchingStage.pipelineName || getPipelineNameById(pipelineId),
        stageName: matchingStage.name,
        stageColor: matchingStage.color
      };
    }
    
    // If no exact match, create a default representation
    return {
      pipelineId,
      pipelineName: getPipelineNameById(pipelineId),
      stageName: statusId,
      stageColor: statusId.startsWith('UC_') ? '#000000' : '#808080' // Black for UC_, gray for others
    };
  };

  const getStatusBadge = (stageId: string) => {
    const stageInfo = getStageInfo(stageId);
    
    if (stageInfo) {
      // Use the actual stage name and color from Bitrix
      return (
        <Badge 
          style={{ backgroundColor: stageInfo.stageColor || undefined }}
          variant="outline"
        >
          {stageInfo.stageName}
        </Badge>
      );
    }
    
    // Fallback for unknown stages
    return <Badge>{stageId}</Badge>;
  };

  const getPipelineName = (stageId: string) => {
    const pipelineId = extractPipelineId(stageId);
    return getPipelineNameById(pipelineId);
  };

  return (
    <Card className="shadow-md">
      <CardHeader className="pt-5 px-6 bg-gradient-to-r from-blue-50 to-white">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl font-bold text-blue-800">Flow Kayıtları</CardTitle>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-xs border-blue-200 focus:border-blue-500"
            />
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowDebug(!showDebug)}
              className="border-blue-200 hover:bg-blue-50"
            >
              {showDebug ? 'Hata Ayıklama Gizle' : 'Hata Ayıklama'}
            </Button>
          </div>
        </div>
        <CardDescription className="text-blue-600 font-medium">
          Seçilen tarih aralığındaki flow kayıtları
          {isLoading && (
            <span className="ml-2 inline-flex items-center">
              <Loader2 className="mr-1 h-4 w-4 animate-spin text-blue-600" />
              Pipeline bilgileri yükleniyor...
            </span>
          )}
          {error && (
            <span className="ml-2 text-red-500 font-semibold">{error}</span>
          )}
        </CardDescription>
        
        {showDebug && debugInfo && (
          <div className="mt-4 p-4 bg-blue-50 rounded-md text-xs border border-blue-200">
            <h4 className="font-bold mb-2 text-blue-800">Hata Ayıklama Bilgileri:</h4>
            <p>Pipeline Sayısı: {debugInfo.pipelineCount}</p>
            <p>Stage Sayısı: {debugInfo.stageCount}</p>
            {debugInfo.samplePipeline && (
              <div className="mt-2">
                <p className="font-semibold text-blue-700">Örnek Pipeline:</p>
                <pre className="bg-white p-2 rounded mt-1 overflow-auto max-h-20 border border-blue-100">
                  {JSON.stringify(debugInfo.samplePipeline, null, 2)}
                </pre>
              </div>
            )}
            {debugInfo.sampleStage && (
              <div className="mt-2">
                <p className="font-semibold text-blue-700">Örnek Stage:</p>
                <pre className="bg-white p-2 rounded mt-1 overflow-auto max-h-20 border border-blue-100">
                  {JSON.stringify(debugInfo.sampleStage, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-6">
        <div className="rounded-md border border-blue-100 overflow-hidden">
          <Table>
            <TableCaption>
              {flowItems.length > 0
                ? `Toplam ${flowItems.length} kayıt gösteriliyor.`
                : "Kayıt bulunamadı."}
            </TableCaption>
            <TableHeader className="bg-blue-50">
              <TableRow>
                <TableHead
                  className="cursor-pointer hover:bg-blue-100 transition-colors"
                  onClick={() => handleSort("id")}
                >
                  ID {sortColumn === "id" && (sortDirection === "asc" ? "▲" : "▼")}
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-blue-100 transition-colors"
                  onClick={() => handleSort("title")}
                >
                  Başlık {sortColumn === "title" && (sortDirection === "asc" ? "▲" : "▼")}
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-blue-100 transition-colors"
                  onClick={() => handleSort("createdTime")}
                >
                  Tarih {sortColumn === "createdTime" && (sortDirection === "asc" ? "▲" : "▼")}
                </TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead>Pipeline</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedItems.length > 0 ? (
                paginatedItems.map((item) => (
                  <TableRow key={item.id} className="hover:bg-blue-50">
                    <TableCell className="font-medium">
                      <a 
                        href={`https://crm.robotpos.com/page/call_center/call_center_spa/type/1036/details/${item.id}/`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {item.id}
                      </a>
                    </TableCell>
                    <TableCell>{item.title}</TableCell>
                    <TableCell>{formatDate(item.createdTime)}</TableCell>
                    <TableCell>{item.ufCrm6_1735552809 || "-"}</TableCell>
                    <TableCell className="font-medium">{getPipelineName(item.stageId)}</TableCell>
                    <TableCell>{getStatusBadge(item.stageId)}</TableCell>
                    <TableCell className="text-right">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedItem(item)}
                            className="bg-white hover:bg-blue-50 border-blue-200"
                          >
                            <Info className="h-4 w-4 mr-1 text-blue-600" />
                            Detay
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                          <DialogHeader className="bg-blue-50 p-4 rounded-t-lg">
                            <DialogTitle className="text-blue-800">Flow Kaydı Detayı</DialogTitle>
                            <DialogDescription>
                              ID: {selectedItem?.id} - {selectedItem?.title}
                            </DialogDescription>
                          </DialogHeader>
                          <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                              <span className="text-right font-medium">ID:</span>
                              <a 
                                href={`https://crm.robotpos.com/page/call_center/call_center_spa/type/1036/details/${selectedItem?.id}/`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="col-span-3 text-blue-600 hover:text-blue-800 hover:underline"
                              >
                                {selectedItem?.id}
                              </a>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                              <span className="text-right font-medium">Başlık:</span>
                              <span className="col-span-3">{selectedItem?.title}</span>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                              <span className="text-right font-medium">Oluşturulma:</span>
                              <span className="col-span-3">
                                {selectedItem && formatDate(selectedItem.createdTime)}
                              </span>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                              <span className="text-right font-medium">Telefon:</span>
                              <span className="col-span-3">{selectedItem?.ufCrm6_1735552809 || "-"}</span>
                            </div>
                            {selectedItem && (
                              <div className="grid grid-cols-4 items-center gap-4">
                                <span className="text-right font-medium">Pipeline:</span>
                                <span className="col-span-3 font-medium text-blue-700">{getPipelineName(selectedItem.stageId)}</span>
                              </div>
                            )}
                            <div className="grid grid-cols-4 items-center gap-4">
                              <span className="text-right font-medium">Durum:</span>
                              <span className="col-span-3">
                                {selectedItem && getStatusBadge(selectedItem.stageId)}
                              </span>
                            </div>
                            {selectedItem && (
                              <div className="grid grid-cols-4 items-center gap-4">
                                <span className="text-right font-medium">Stage ID:</span>
                                <span className="col-span-3 font-mono text-sm bg-gray-100 p-1 rounded">{selectedItem.stageId}</span>
                              </div>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    Sonuç bulunamadı.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between space-x-2 py-4 mt-4 bg-gray-50 p-3 rounded-md">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">
              Sayfa başına gösterim
            </span>
            <Select
              value={pageSize.toString()}
              onValueChange={(value) => {
                setPageSize(parseInt(value));
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-[70px] border-blue-200">
                <SelectValue placeholder={pageSize.toString()} />
              </SelectTrigger>
              <SelectContent side="top">
                {[5, 10, 20, 50].map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              {paginatedItems.length} / {filteredItems.length} kayıt
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              disabled={currentPage <= 1}
              className="border-blue-200 hover:bg-blue-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Önceki
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCurrentPage((prev) => Math.min(prev + 1, totalPages))
              }
              disabled={currentPage >= totalPages}
              className="border-blue-200 hover:bg-blue-50"
            >
              Sonraki
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
