import React, { useState } from "react";
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
import { ChevronLeft, ChevronRight, Info } from "lucide-react";

interface FlowItem {
  id: string;
  title: string;
  stageId: string;
  opened: string;
  createdTime: string;
  ufCrm6_1735552809?: string; // Phone field
  companyId?: string;
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

  const getStatusBadge = (stageId: string) => {
    if (stageId === "DT1036_28:NEW") {
      return <Badge variant="secondary">Yeni</Badge>;
    } else if (stageId === "DT1036_10:SUCCESS" || stageId === "DT1036_32:SUCCESS") {
      return <Badge variant="success">Başarılı</Badge>;
    } else if (stageId === "DT1036_10:FAIL") {
      return <Badge variant="destructive">Başarısız</Badge>;
    } else {
      return <Badge>{stageId}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader className="pt-5 px-6">
        <div className="flex items-center justify-between">
          <CardTitle>Flow Kayıtları</CardTitle>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-xs"
            />
          </div>
        </div>
        <CardDescription>
          Seçilen tarih aralığındaki flow kayıtları
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableCaption>
              {flowItems.length > 0
                ? `Toplam ${flowItems.length} kayıt gösteriliyor.`
                : "Kayıt bulunamadı."}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead
                  className="cursor-pointer"
                  onClick={() => handleSort("id")}
                >
                  ID {sortColumn === "id" && (sortDirection === "asc" ? "▲" : "▼")}
                </TableHead>
                <TableHead
                  className="cursor-pointer"
                  onClick={() => handleSort("title")}
                >
                  Başlık {sortColumn === "title" && (sortDirection === "asc" ? "▲" : "▼")}
                </TableHead>
                <TableHead
                  className="cursor-pointer"
                  onClick={() => handleSort("createdTime")}
                >
                  Tarih {sortColumn === "createdTime" && (sortDirection === "asc" ? "▲" : "▼")}
                </TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedItems.length > 0 ? (
                paginatedItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.id}</TableCell>
                    <TableCell>{item.title}</TableCell>
                    <TableCell>{formatDate(item.createdTime)}</TableCell>
                    <TableCell>{item.ufCrm6_1735552809 || "-"}</TableCell>
                    <TableCell>{getStatusBadge(item.stageId)}</TableCell>
                    <TableCell className="text-right">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedItem(item)}
                          >
                            <Info className="h-4 w-4 mr-1" />
                            Detay
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                          <DialogHeader>
                            <DialogTitle>Flow Kaydı Detayı</DialogTitle>
                            <DialogDescription>
                              ID: {selectedItem?.id} - {selectedItem?.title}
                            </DialogDescription>
                          </DialogHeader>
                          <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                              <span className="text-right font-medium">ID:</span>
                              <span className="col-span-3">{selectedItem?.id}</span>
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
                            <div className="grid grid-cols-4 items-center gap-4">
                              <span className="text-right font-medium">Durum:</span>
                              <span className="col-span-3">
                                {selectedItem && getStatusBadge(selectedItem.stageId)}
                              </span>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    Sonuç bulunamadı.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between space-x-2 py-4">
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
              <SelectTrigger className="h-8 w-[70px]">
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
