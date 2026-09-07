import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import {
  useTable,
  tableFeatures,
  rowSortingFeature,
  createSortedRowModel,
  type ColumnDef
} from '@tanstack/react-table';
import { Button } from './ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';

export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel()
});

type DataTableProps<T extends { id: string }> = {
  data: T[];
  columns: ColumnDef<typeof dataTableFeatures, T>[];
  label: string;
  emptyMessage?: string;
};

export function DataTable<T extends { id: string }>({
  data,
  columns,
  label,
  emptyMessage = 'No results found.'
}: DataTableProps<T>) {
  const table = useTable({ features: dataTableFeatures, data, columns, getRowId: (row) => row.id });
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table aria-label={label}>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const SortIcon =
                  sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown;
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={
                      sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                    }
                  >
                    {header.column.getCanSort() ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <table.FlexRender header={header} />
                        <SortIcon className="size-3.5" />
                      </Button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className="px-4 py-3 align-top whitespace-normal">
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-36 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
