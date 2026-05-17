import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Calendar, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULT_MAX_VISIBLE_ITEMS = 5;
const NO_PROJECT_VALUE = 'none';

const getTodayDateString = () => new Date().toISOString().split('T')[0];

const formatShortDate = (value) => {
  if (!value) return '';

  const datePart = String(value).split('T')[0];
  const parts = datePart.split('-');
  if (parts.length !== 3) return datePart;

  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (Number.isNaN(date.getTime())) return datePart;

  return new Intl.DateTimeFormat('he-IL').format(date);
};

const getTaskProjectId = (task) => task?.project_id || null;

const getTaskProjectName = (task) => {
  const name = task?.project_name || task?.related_project_name;
  return name ? String(name).trim() : '';
};

function TaskRow({ task, onComplete, isCompleting, onOpenProject }) {
  const projectId = getTaskProjectId(task);
  const projectName = getTaskProjectName(task);
  const canOpenProject = Boolean(projectId && onOpenProject);

  const handleOpenProject = () => {
    if (canOpenProject) onOpenProject(projectId);
  };

  const titleBlock = (
  <>
      <div className="font-medium text-sm mb-1">{task.title}</div>
      {projectName && (
        <div className="text-xs text-muted-foreground">
          פרויקט: {canOpenProject ? (
            <button
              type="button"
              onClick={handleOpenProject}
              className="underline underline-offset-2 hover:text-primary"
            >
              {projectName}
            </button>
          ) : (
            projectName
          )}
        </div>
      )}
      {task.description && (
        <div className="text-xs text-muted-foreground mt-1">{task.description}</div>
      )}
      {task.due_date && (
        <div className="text-xs text-muted-foreground mt-1">
          תאריך: {formatShortDate(task.due_date)}
        </div>
      )}
    </>
  );

  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border border-slate-200 bg-slate-50/50 text-right">
      <Checkbox
        checked={false}
        disabled={isCompleting}
        onCheckedChange={(checked) => {
          if (checked) onComplete(task);
        }}
        className="mt-0.5"
        aria-label={`סמן את "${task.title}" כהושלם`}
      />
      {canOpenProject ? (
        <button
          type="button"
          onClick={handleOpenProject}
          className="flex-1 min-w-0 text-right hover:bg-slate-100/80 rounded-md -m-1 p-1 transition-colors"
        >
          {titleBlock}
        </button>
      ) : (
        <div className="flex-1 min-w-0">{titleBlock}</div>
      )}
    </div>
  );
}

export default function TodayTasksCard({ tasks = [], projects = [] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAllDialogOpen, setIsAllDialogOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(getTodayDateString());
  const [selectedProjectId, setSelectedProjectId] = useState(NO_PROJECT_VALUE);
  const [completingTaskId, setCompletingTaskId] = useState(null);

  const sortedProjects = useMemo(() => (
    [...projects].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'))
  ), [projects]);

  const visibleTasks = tasks.slice(0, DEFAULT_MAX_VISIBLE_ITEMS);
  const hasMoreTasks = tasks.length > DEFAULT_MAX_VISIBLE_ITEMS;

  const openProjectDetails = (projectId) => {
    if (!projectId) return;
    navigate(createPageUrl(`ProjectDetails?id=${projectId}`));
  };

  const resetAddForm = () => {
    setTitle('');
    setDescription('');
    setDueDate(getTodayDateString());
    setSelectedProjectId(NO_PROJECT_VALUE);
  };

  const handleAddDialogOpenChange = (open) => {
    setIsAddDialogOpen(open);
    if (!open) resetAddForm();
  };

  const createMutation = useMutation({
    mutationFn: (payload) => base44.entities.Task.create(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      handleAddDialogOpenChange(false);
    },
    onError: (err) => {
      alert('שגיאה ביצירת משימה: ' + (err?.message || err));
    },
  });

  const completeMutation = useMutation({
    mutationFn: ({ taskId, payload }) => base44.entities.Task.update(taskId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setCompletingTaskId(null);
    },
    onError: (err) => {
      setCompletingTaskId(null);
      alert('שגיאה בעדכון משימה: ' + (err?.message || err));
    },
  });

  const handleCreateTask = () => {
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      alert('יש להזין כותרת משימה');
      return;
    }

    if (!dueDate.trim()) {
      alert('יש לבחור תאריך משימה');
      return;
    }

    const payload = {
      title: trimmedTitle,
      description: description.trim(),
      due_date: dueDate.split('T')[0],
      is_completed: false,
      created_at: new Date().toISOString(),
    };

    if (selectedProjectId !== NO_PROJECT_VALUE) {
      const project = sortedProjects.find((item) => item.id === selectedProjectId);
      if (project?.id) {
        payload.project_id = project.id;
        if (project.name) {
          payload.project_name = project.name;
        }
      }
    }

    createMutation.mutate(payload);
  };

  const handleCompleteTask = (task) => {
    if (!task?.id || completingTaskId) return;

    setCompletingTaskId(task.id);
    completeMutation.mutate({
      taskId: task.id,
      payload: {
        is_completed: true,
        completed_at: new Date().toISOString(),
      },
    });
  };

  const renderTaskList = (taskList) => (
    <div className="space-y-3">
      {taskList.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          onComplete={handleCompleteTask}
          isCompleting={completingTaskId === task.id || completeMutation.isPending}
          onOpenProject={openProjectDetails}
        />
      ))}
    </div>
  );

  return (
    <>
      <Card className="border-0 bg-white shadow-sm hover:shadow-md transition-all">
        <div className="p-8">
          <div className="flex items-center justify-between mb-6 gap-3">
            <div className="flex items-center gap-3">
              <Calendar className="w-6 h-6 text-purple-700" strokeWidth={1.5} />
              <h3 className="text-xl font-semibold">משימות להיום</h3>
            </div>
            <Badge
              variant="outline"
              className={cn('text-sm font-semibold px-3 py-1', 'bg-purple-100 text-purple-700 border-purple-200')}
            >
              {tasks.length}
            </Badge>
          </div>

          <div className="mb-4">
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={() => handleAddDialogOpenChange(true)}
            >
              <Plus className="w-4 h-4" />
              הוסף משימה
            </Button>
          </div>

          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין משימות פתוחות להיום</p>
          ) : (
            <>
              {renderTaskList(visibleTasks)}
              {hasMoreTasks && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full mt-4"
                  onClick={() => setIsAllDialogOpen(true)}
                >
                  הצג הכל
                </Button>
              )}
            </>
          )}
        </div>
      </Card>

      <Dialog open={isAddDialogOpen} onOpenChange={handleAddDialogOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>הוספת משימה</DialogTitle>
            <DialogDescription>
              הזן פרטי משימה, תאריך יעד ושיוך פרויקט אופציונלי.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="task-title">כותרת משימה</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="לדוגמה: להתקשר ללקוח"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-description">תיאור / הערה</Label>
              <Textarea
                id="task-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="פרטים נוספים (אופציונלי)"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-due-date">תאריך משימה</Label>
              <Input
                id="task-due-date"
                type="date"
                className="w-full"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-project">שיוך לפרויקט</Label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger id="task-project">
                  <SelectValue placeholder="בחר פרויקט" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROJECT_VALUE}>ללא שיוך לפרויקט</SelectItem>
                  {sortedProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name || 'פרויקט ללא שם'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleAddDialogOpenChange(false)}
              disabled={createMutation.isPending}
            >
              ביטול
            </Button>
            <Button
              type="button"
              onClick={handleCreateTask}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'שומר...' : 'שמור'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAllDialogOpen} onOpenChange={setIsAllDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>משימות להיום</DialogTitle>
            <DialogDescription>
              {tasks.length} משימות פתוחות להיום
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto pr-1 -mr-1 flex-1">
            {renderTaskList(tasks)}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
