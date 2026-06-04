import React from 'react';
import {
  DragDropContext,
  Draggable,
  Droppable,
} from '@hello-pangea/dnd';
import WorkStageCard from '@/components/workflow/WorkStageCard';

export default function WorkStageSortableList({
  stages = [],
  statusByStageId = {},
  statusLabels = {},
  highlightedStageId = '',
  busyStageId = null,
  onDragEnd,
  onEdit,
  onDelete,
  onCancel,
  onApprovalToggle,
}) {
  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="work-stages-list">
        {(droppableProvided) => (
          <div
            ref={droppableProvided.innerRef}
            {...droppableProvided.droppableProps}
            className="flex w-full flex-col gap-3"
          >
            {stages.map((stage, index) => {
              const normalizedStatus = statusByStageId[stage.id] || stage.status;
              const statusLabel = statusLabels[normalizedStatus] || normalizedStatus;

              return (
                <Draggable key={stage.id} draggableId={stage.id} index={index}>
                  {(draggableProvided, snapshot) => (
                    <div
                      ref={draggableProvided.innerRef}
                      {...draggableProvided.draggableProps}
                      style={draggableProvided.draggableProps.style}
                      className="w-full"
                    >
                      <WorkStageCard
                        stage={stage}
                        orderIndex={stage.order_index ?? index + 1}
                        statusLabel={statusLabel}
                        isHighlighted={highlightedStageId === stage.id}
                        isDragging={snapshot.isDragging}
                        isBusy={busyStageId === stage.id || busyStageId === 'reorder'}
                        dragHandleProps={draggableProvided.dragHandleProps}
                        onEdit={onEdit}
                        onDelete={onDelete}
                        onCancel={onCancel}
                        onApprovalToggle={onApprovalToggle}
                      />
                    </div>
                  )}
                </Draggable>
              );
            })}
            {droppableProvided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}
