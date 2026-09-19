import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  Mail,
  Plus,
  Pencil,
  Trash2,
  Star,
  Loader2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  settingsBadgePillClass,
  settingsCardClass,
  settingsDangerButtonClass,
  settingsDialogClass,
  settingsInputClass,
  settingsInteractiveRowClass,
  settingsPanelClass,
  settingsPillButtonClass,
  settingsPrimaryButtonClass,
  settingsSwitchClass,
  settingsCx,
} from "@/components/settings/settingsUi";

interface FinanceContact {
  id: string;
  name: string;
  email: string;
  company: string | null;
  is_default: boolean;
  is_active: boolean;
  contact_type: string;
  notes: string | null;
  created_at: string;
}

interface ContactFormData {
  name: string;
  email: string;
  company: string;
  contact_type: "internal" | "external";
  notes: string;
  is_default: boolean;
}

const defaultFormData: ContactFormData = {
  name: "",
  email: "",
  company: "",
  contact_type: "external",
  notes: "",
  is_default: false,
};

export function FinanceAgentContacts() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<FinanceContact | null>(
    null,
  );
  const [formData, setFormData] = useState<ContactFormData>(defaultFormData);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["finance-agent-contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_agent_contacts")
        .select("*")
        .order("is_default", { ascending: false })
        .order("name");

      if (error) throw error;
      return data as FinanceContact[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ContactFormData) => {
      const { error } = await supabase.from("finance_agent_contacts").insert({
        ...data,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-agent-contacts"] });
      toast.success("Finance contact added");
      handleCloseDialog();
    },
    onError: (error: any) => {
      toast.error("Failed to add contact: " + error.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ContactFormData }) => {
      const { error } = await supabase
        .from("finance_agent_contacts")
        .update(data)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-agent-contacts"] });
      toast.success("Finance contact updated");
      handleCloseDialog();
    },
    onError: (error: any) => {
      toast.error("Failed to update contact: " + error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("finance_agent_contacts")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-agent-contacts"] });
      toast.success("Finance contact removed");
    },
    onError: (error: any) => {
      toast.error("Failed to remove contact: " + error.message);
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      // First, unset all defaults
      await supabase
        .from("finance_agent_contacts")
        .update({ is_default: false })
        .eq("is_default", true);

      // Set the new default
      const { error } = await supabase
        .from("finance_agent_contacts")
        .update({ is_default: true })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-agent-contacts"] });
      toast.success("Default contact updated");
    },
    onError: (error: any) => {
      toast.error("Failed to set default: " + error.message);
    },
  });

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingContact(null);
    setFormData(defaultFormData);
  };

  const handleOpenEdit = (contact: FinanceContact) => {
    setEditingContact(contact);
    setFormData({
      name: contact.name,
      email: contact.email,
      company: contact.company || "",
      contact_type: contact.contact_type as "internal" | "external",
      notes: contact.notes || "",
      is_default: contact.is_default,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.email.trim()) {
      toast.error("Name and email are required");
      return;
    }

    if (editingContact) {
      updateMutation.mutate({ id: editingContact.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Card className={settingsCardClass}>
      <CardHeader className="space-y-4">
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <CardTitle className="flex min-w-0 items-center gap-2 text-lg md:text-xl">
              <Users className="h-5 w-5 shrink-0" />
              Finance Agent Contacts
            </CardTitle>
            <CardDescription className="max-w-2xl break-words leading-6">
              Manage recipients for "Quick Send to Finance" feature
            </CardDescription>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                onClick={() => setFormData(defaultFormData)}
                className={settingsCx(
                  settingsPillButtonClass,
                  settingsPrimaryButtonClass,
                  "w-full sm:w-auto",
                )}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Contact
              </Button>
            </DialogTrigger>
            <DialogContent
              className={settingsCx(
                settingsDialogClass,
                "max-h-[90vh] overflow-y-auto sm:max-w-2xl",
              )}
            >
              <DialogHeader className="space-y-2">
                <DialogTitle>
                  {editingContact
                    ? "Edit Finance Contact"
                    : "Add Finance Contact"}
                </DialogTitle>
                <DialogDescription>
                  {editingContact
                    ? "Update the finance agent contact details"
                    : "Add a new finance agent to receive Formara forms"}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
                <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      className={settingsInputClass}
                      value={formData.name}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      placeholder="John Smith"
                    />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      className={settingsInputClass}
                      type="email"
                      value={formData.email}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          email: e.target.value,
                        }))
                      }
                      placeholder="john@example.com"
                    />
                  </div>
                </div>

                <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="company">Company</Label>
                    <Input
                      id="company"
                      className={settingsInputClass}
                      value={formData.company}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          company: e.target.value,
                        }))
                      }
                      placeholder="Finance Corp"
                    />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="contact_type">Contact Type</Label>
                    <Select
                      value={formData.contact_type}
                      onValueChange={(value: "internal" | "external") =>
                        setFormData((prev) => ({
                          ...prev,
                          contact_type: value,
                        }))
                      }
                    >
                      <SelectTrigger className="min-w-0 focus:ring-primary">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="internal">Internal</SelectItem>
                        <SelectItem value="external">External</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="min-w-0 space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    className="min-w-0 resize-y break-words focus-visible:ring-primary"
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        notes: e.target.value,
                      }))
                    }
                    placeholder="Additional notes about this contact..."
                    rows={2}
                  />
                </div>

                <div
                  className={settingsCx(
                    settingsPanelClass,
                    "flex items-center gap-3",
                  )}
                >
                  <Switch
                    id="is_default"
                    className={settingsSwitchClass}
                    checked={formData.is_default}
                    onCheckedChange={(checked) =>
                      setFormData((prev) => ({ ...prev, is_default: checked }))
                    }
                  />
                  <Label htmlFor="is_default">Set as default recipient</Label>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCloseDialog}
                    className={settingsPillButtonClass}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isPending}
                    className={settingsCx(
                      settingsPillButtonClass,
                      settingsPrimaryButtonClass,
                    )}
                  >
                    {isPending && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    {editingContact ? "Update" : "Add"} Contact
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        {isLoading ? (
          <div className="flex items-center justify-center rounded-2xl border border-border/60 bg-muted/30 py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-muted/25 px-4 py-8 text-center text-muted-foreground">
            <Users className="mx-auto mb-3 h-12 w-12 opacity-50" />
            <p>No finance contacts configured yet.</p>
            <p className="text-sm">
              Add contacts to enable "Quick Send to Finance" feature.
            </p>
          </div>
        ) : (
          <div className="min-h-0 min-w-0 overflow-x-auto overscroll-x-contain rounded-2xl border border-border/60 bg-background/35 [scrollbar-gutter:stable] dark:border-white/10">
            <Table className="min-w-[760px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[22%]">Name</TableHead>
                  <TableHead className="w-[28%]">Email</TableHead>
                  <TableHead className="w-[22%]">Company</TableHead>
                  <TableHead className="w-[12%]">Type</TableHead>
                  <TableHead className="w-[16%] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact) => (
                  <TableRow
                    key={contact.id}
                    className={settingsInteractiveRowClass}
                  >
                    <TableCell className="align-top font-medium">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 break-words">
                          {contact.name}
                        </span>
                        {contact.is_default && (
                          <Badge
                            variant="default"
                            className={settingsCx(
                              settingsBadgePillClass,
                              "gap-1 bg-primary text-xs text-primary-foreground",
                            )}
                          >
                            <Star className="h-3 w-3 mr-1" />
                            Default
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex min-w-0 items-start gap-1 text-sm text-muted-foreground">
                        <Mail className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="min-w-0 break-all">
                          {contact.email}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      {contact.company ? (
                        <div className="flex min-w-0 items-start gap-1 text-sm">
                          <Building2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 break-words">
                            {contact.company}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge
                        variant={
                          contact.contact_type === "internal"
                            ? "secondary"
                            : "outline"
                        }
                        className={settingsCx(
                          settingsBadgePillClass,
                          "capitalize",
                        )}
                      >
                        {contact.contact_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <div className="flex justify-end gap-1">
                        {!contact.is_default && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setDefaultMutation.mutate(contact.id)
                            }
                            title="Set as default"
                            aria-label={`Set ${contact.name} as default finance contact`}
                            className={settingsCx(
                              settingsPillButtonClass,
                              "hover:bg-primary/10 hover:text-primary",
                            )}
                          >
                            <Star className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(contact)}
                          aria-label={`Edit ${contact.name}`}
                          className={settingsCx(
                            settingsPillButtonClass,
                            "hover:bg-primary/10 hover:text-primary",
                          )}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(contact.id)}
                          aria-label={`Delete ${contact.name}`}
                          className={settingsDangerButtonClass}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
