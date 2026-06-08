import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PAPERLESS_INVOICE_URL } from '@/lib/collectionDueUtils';

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const formatAmount = (value) => new Intl.NumberFormat('he-IL').format(toNumber(value));

export default function CompleteCollectionDueDialog({
  open,
  onOpenChange,
  collectionDue,
  onComplete,
  isSaving = false,
}) {
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [taxInvoiceSent, setTaxInvoiceSent] = useState(false);
  const [taxInvoiceReference, setTaxInvoiceReference] = useState('');

  const awaitingTaxOnly = collectionDue?.status === 'awaiting_tax_invoice';

  useEffect(() => {
    if (!open || !collectionDue) return;

    setPaymentReceived(awaitingTaxOnly || collectionDue.payment_received === true);
    setTaxInvoiceSent(collectionDue.tax_invoice_sent_to_client === true);
    setTaxInvoiceReference(collectionDue.tax_invoice_reference || '');
  }, [open, collectionDue, awaitingTaxOnly]);

  const amountDue = useMemo(() => toNumber(collectionDue?.amount_due), [collectionDue?.amount_due]);
  const amountPaid = useMemo(
    () => (paymentReceived ? amountDue : toNumber(collectionDue?.amount_paid)),
    [paymentReceived, amountDue, collectionDue?.amount_paid],
  );
  const remaining = useMemo(
    () => Math.max(amountDue - amountPaid, 0),
    [amountDue, amountPaid],
  );

  const canSave = awaitingTaxOnly
    ? taxInvoiceSent
    : paymentReceived || taxInvoiceSent;

  const handleSave = () => {
    if (!canSave || isSaving) return;

    onComplete?.({
      paymentReceived: awaitingTaxOnly ? true : paymentReceived,
      taxInvoiceSent,
      taxInvoiceReference: taxInvoiceReference.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>סיום גבייה</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-3 gap-3 rounded-md border p-3 bg-muted/30">
            <div>
              <div className="text-xs text-muted-foreground">סכום לגבייה</div>
              <div className="font-medium">{formatAmount(amountDue)} ₪</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">סכום ששולם</div>
              <div className="font-medium">{formatAmount(amountPaid)} ₪</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">יתרה</div>
              <div className="font-medium">{formatAmount(remaining)} ₪</div>
            </div>
          </div>

          {!awaitingTaxOnly ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="collection-payment-received"
                checked={paymentReceived}
                onCheckedChange={(value) => setPaymentReceived(value === true)}
                disabled={isSaving}
              />
              <Label htmlFor="collection-payment-received" className="cursor-pointer">
                התשלום התקבל מהלקוח
              </Label>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              התשלום כבר סומן כהתקבל. נותר לסמן שליחת חשבונית מס.
            </p>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="collection-tax-invoice-sent"
                checked={taxInvoiceSent}
                onCheckedChange={(value) => setTaxInvoiceSent(value === true)}
                disabled={isSaving}
              />
              <Label htmlFor="collection-tax-invoice-sent" className="cursor-pointer">
                חשבונית מס נשלחה ללקוח
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mr-auto gap-1"
                asChild
              >
                <a href={PAPERLESS_INVOICE_URL} target="_blank" rel="noopener noreferrer">
                  פתח Paperless
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="collection-tax-invoice-reference">מספר חשבונית מס / אסמכתא (אופציונלי)</Label>
            <Input
              id="collection-tax-invoice-reference"
              value={taxInvoiceReference}
              onChange={(event) => setTaxInvoiceReference(event.target.value)}
              disabled={isSaving}
              placeholder="לדוגמה: 12345"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            ביטול
          </Button>
          <Button type="button" onClick={handleSave} disabled={!canSave || isSaving}>
            {isSaving ? 'שומר...' : 'שמור'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
