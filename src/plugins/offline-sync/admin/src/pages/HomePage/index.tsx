import React, { useState, useEffect, useCallback } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import {
  Box,
  Flex,
  Typography,
  Button,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Loader,
  Link,
  IconButton,
  Modal,
  Tabs,
  Grid,
  JSONInput,
  Field,
  SingleSelect,
  SingleSelectOption,
} from '@strapi/design-system';
// Simple icons
const RefreshIcon = () => <span>🔄</span>;
const WarningIcon = () => <span>⚠️</span>;
const CloseIcon = () => <span>✕</span>;

// Types
interface SyncStatus {
  mode: 'master' | 'replica';
  shipId: string | null;
  queueSize: number;
  connectivity: 'online' | 'offline';
}

interface QueueItem {
  id: number;
  ship_id: string;
  content_type: string;
  content_id: string;
  operation: 'create' | 'update' | 'delete';
  status: 'pending' | 'syncing' | 'pushed' | 'synced' | 'failed';
  local_version: number;
  created_at: string;
  synced_at: string | null;
  error_message: string | null;
}

interface Conflict {
  id: number;
  content_type: string;
  content_id: number;
  ship_id: string;
  ship_version: number;
  master_version: number;
  ship_data: any;
  master_data: any;
  conflict_type: string;
  created_at: string;
  resolved_at: string | null;
  resolution_strategy: string | null;
}

interface Ship {
  id: number;
  ship_id: string;
  ship_name: string;
  last_seen_at: string;
  connectivity_status: 'online' | 'offline';
  created_at: string;
  updated_at: string;
}

// Helper to get content manager URL
const getContentManagerUrl = (contentType: string, documentId: string): string => {
  // Convert api::article.article to article
  const parts = contentType.split('.');
  const modelName = parts[parts.length - 1];
  return `/admin/content-manager/collection-types/${contentType}/${documentId}`;
};

// Status Badge Component
const StatusBadge = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    online: 'success',
    offline: 'danger',
    pending: 'warning',
    syncing: 'primary',
    pushed: 'secondary',  // Sent to Kafka, awaiting Master
    synced: 'success',    // Master confirmed
    failed: 'danger',
  };

  const labels: Record<string, string> = {
    pending: 'PENDING',
    syncing: 'SENDING...',
    pushed: 'AWAITING MASTER',  // More accurate label
    synced: 'CONFIRMED',        // Master confirmed
    failed: 'FAILED',
  };

  return (
    <Badge backgroundColor={`${colors[status] || 'neutral'}100`} textColor={`${colors[status] || 'neutral'}700`}>
      {labels[status] || status.toUpperCase()}
    </Badge>
  );
};

// Operation Badge Component
const OperationBadge = ({ operation }: { operation: string }) => {
  const colors: Record<string, string> = {
    create: 'success',
    update: 'primary',
    delete: 'danger',
  };

  return (
    <Badge backgroundColor={`${colors[operation] || 'neutral'}100`} textColor={`${colors[operation] || 'neutral'}700`}>
      {operation.toUpperCase()}
    </Badge>
  );
};

// Stats Card Component
const StatsCard = ({
  title,
  value,
  color = 'primary'
}: {
  title: string;
  value: string | number;
  color?: string;
}) => (
  <Box
    background="neutral0"
    padding={4}
    borderRadius="8px"
    shadow="filterShadow"
    style={{ minWidth: '180px' }}
  >
    <Flex direction="column" gap={2}>
      <Typography variant="pi" fontWeight="bold" textColor="neutral600">
        {title}
      </Typography>
      <Typography variant="alpha" fontWeight="bold" textColor={`${color}600`}>
        {value}
      </Typography>
    </Flex>
  </Box>
);

const HomePage = () => {
  const { get, post } = useFetchClient();

  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [ships, setShips] = useState<Ship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Conflict modal state
  const [selectedConflict, setSelectedConflict] = useState<Conflict | null>(null);
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);
  const [resolutionStrategy, setResolutionStrategy] = useState<string>('keep-master');
  const [resolving, setResolving] = useState(false);

  // Fetch data based on mode (resilient - individual errors don't break the dashboard)
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // First fetch status to know the mode
      const statusRes = await get('/api/offline-sync/status');
      const currentMode = statusRes.data?.mode;
      setStatus(statusRes.data);

      // Fetch mode-specific data in parallel with individual error handling
      if (currentMode === 'master') {
        // Master: fetch ships and conflicts (individually caught)
        const [shipsResult, conflictsResult] = await Promise.allSettled([
          get('/api/offline-sync/ships'),
          get('/api/offline-sync/conflicts'),
        ]);

        // Handle ships
        if (shipsResult.status === 'fulfilled') {
          setShips(shipsResult.value.data.ships || []);
        } else {
          console.warn('Failed to fetch ships:', shipsResult.reason);
          setShips([]);
        }

        // Handle conflicts
        if (conflictsResult.status === 'fulfilled') {
          setConflicts(conflictsResult.value.data.conflicts || []);
        } else {
          console.warn('Failed to fetch conflicts:', conflictsResult.reason);
          setConflicts([]);
        }

        setQueue([]); // Clear queue on master
      } else {
        // Replica: fetch queue only
        try {
          const queueRes = await get('/api/offline-sync/queue');
          setQueue(queueRes.data.queue || []);
        } catch (queueErr) {
          console.warn('Failed to fetch queue:', queueErr);
          setQueue([]);
        }
        setShips([]); // Clear ships on replica
        setConflicts([]); // Clear conflicts on replica
      }

      setLastRefresh(new Date());
    } catch (err: any) {
      // Ignore abort errors (happens when component unmounts or navigation)
      if (err.name === 'AbortError' || err.message?.includes('abort')) {
        return;
      }
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [get]);

  // Resolve a conflict
  const handleResolveConflict = async () => {
    if (!selectedConflict) return;

    try {
      setResolving(true);
      await post(`/api/offline-sync/conflicts/${selectedConflict.id}/resolve`, {
        strategy: resolutionStrategy,
      });

      // Close modal and refresh data
      setIsConflictModalOpen(false);
      setSelectedConflict(null);
      await fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to resolve conflict');
    } finally {
      setResolving(false);
    }
  };

  // Open conflict detail modal
  const openConflictModal = (conflict: Conflict) => {
    setSelectedConflict(conflict);
    setResolutionStrategy('keep-master');
    setIsConflictModalOpen(true);
  };

  // Initial fetch
  useEffect(() => {
    fetchData();

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  // Format content type for display
  const formatContentType = (contentType: string) => {
    const parts = contentType.split('::');
    if (parts.length > 1) {
      return parts[1].split('.')[0];
    }
    return contentType;
  };

  // Count by status (Replica)
  const pushedCount = queue.filter(q => q.status === 'pushed').length;  // Awaiting Master
  const syncedCount = queue.filter(q => q.status === 'synced').length;  // Master confirmed
  const failedCount = queue.filter(q => q.status === 'failed').length;

  // Count by status (Master)
  const unresolvedConflictsCount = conflicts.filter(c => !c.resolved_at).length;
  const onlineShipsCount = ships.filter(s => s.connectivity_status === 'online').length;
  const offlineShipsCount = ships.filter(s => s.connectivity_status === 'offline').length;

  if (loading && !status) {
    return (
      <Box padding={8}>
        <Flex justifyContent="center" alignItems="center" style={{ minHeight: '400px' }}>
          <Loader>Loading...</Loader>
        </Flex>
      </Box>
    );
  }

  return (
    <Box padding={8} background="neutral100">
      {/* Header */}
      <Flex justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Box>
          <Typography variant="alpha" fontWeight="bold">
            Offline Sync Dashboard
          </Typography>
          <Box marginTop={2}>
            <Typography variant="epsilon" textColor="neutral600">
              Monitor and manage sync operations
            </Typography>
          </Box>
        </Box>
        <Button
          variant="tertiary"
          startIcon={<RefreshIcon />}
          onClick={fetchData}
          loading={loading}
        >
          Refresh
        </Button>
      </Flex>

      {/* Error Alert */}
      {error && (
        <Box
          background="danger100"
          padding={4}
          borderRadius="4px"
          marginBottom={4}
        >
          <Typography textColor="danger700">{error}</Typography>
        </Box>
      )}

      {/* Stats Cards */}
      <Flex gap={4} marginBottom={6} wrap="wrap">
        <StatsCard
          title="Mode"
          value={status?.mode?.toUpperCase() || 'N/A'}
          color="primary"
        />
        <StatsCard
          title="Connectivity"
          value={status?.connectivity?.toUpperCase() || 'N/A'}
          color={status?.connectivity === 'online' ? 'success' : 'danger'}
        />

        {/* Replica-specific stats */}
        {status?.mode === 'replica' && (
          <>
            <StatsCard
              title="Ship ID"
              value={status?.shipId || 'N/A'}
              color="secondary"
            />
            {pushedCount > 0 && (
              <StatsCard
                title="Awaiting Master"
                value={pushedCount}
                color="warning"
              />
            )}
            <StatsCard
              title="Confirmed"
              value={syncedCount}
              color="success"
            />
            {failedCount > 0 && (
              <StatsCard
                title="Failed"
                value={failedCount}
                color="danger"
              />
            )}
          </>
        )}

        {/* Master-specific stats */}
        {status?.mode === 'master' && (
          <>
            <StatsCard
              title="Ships Online"
              value={onlineShipsCount}
              color="success"
            />
            {offlineShipsCount > 0 && (
              <StatsCard
                title="Ships Offline"
                value={offlineShipsCount}
                color="warning"
              />
            )}
            <StatsCard
              title="Total Ships"
              value={ships.length}
              color="secondary"
            />
            {unresolvedConflictsCount > 0 && (
              <StatsCard
                title="Conflicts"
                value={unresolvedConflictsCount}
                color="danger"
              />
            )}
          </>
        )}
      </Flex>

      {/* Last Refresh */}
      <Box marginBottom={4}>
        <Typography variant="pi" textColor="neutral500">
          Last updated: {lastRefresh.toLocaleTimeString()}
        </Typography>
      </Box>

      {/* Queue Table - Replica Only */}
      {status?.mode === 'replica' && (
        <Box background="neutral0" borderRadius="8px" shadow="filterShadow" padding={4}>
          <Box marginBottom={6}>
            <Typography variant="beta" fontWeight="bold">
              Recent Sync Operations
            </Typography>
          </Box>

          {queue.length === 0 ? (
            <Box padding={6} textAlign="center">
              <Typography textColor="neutral600">
                No sync operations yet. Create or update content to see them here.
              </Typography>
            </Box>
          ) : (
            <Table colCount={8} rowCount={Math.min(queue.length, 20) + 1}>
              <Thead>
                <Tr>
                  <Th><Typography variant="sigma">ID</Typography></Th>
                  <Th><Typography variant="sigma">Content Type</Typography></Th>
                  <Th><Typography variant="sigma">Document ID</Typography></Th>
                  <Th><Typography variant="sigma">Operation</Typography></Th>
                  <Th><Typography variant="sigma">Version</Typography></Th>
                  <Th><Typography variant="sigma">Status</Typography></Th>
                  <Th><Typography variant="sigma">Created</Typography></Th>
                  <Th><Typography variant="sigma">Actions</Typography></Th>
                </Tr>
              </Thead>
              <Tbody>
                {queue.slice(0, 20).map((item) => (
                  <Tr key={item.id}>
                    <Td>
                      <Typography textColor="neutral800">#{item.id}</Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">
                        {formatContentType(item.content_type)}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography
                        textColor="primary600"
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '12px',
                          maxWidth: '150px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.content_id}
                      </Typography>
                    </Td>
                    <Td>
                      <OperationBadge operation={item.operation} />
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">v{item.local_version}</Typography>
                    </Td>
                    <Td>
                      <StatusBadge status={item.status} />
                    </Td>
                    <Td>
                      <Typography variant="pi" textColor="neutral600">
                        {formatDate(item.created_at)}
                      </Typography>
                    </Td>
                    <Td>
                      {item.operation !== 'delete' && (
                        <Link
                          href={getContentManagerUrl(item.content_type, item.content_id)}
                          isExternal={false}
                        >
                          <Button variant="ghost" size="S">
                            View →
                          </Button>
                        </Link>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}

          {queue.length > 20 && (
            <Box padding={4} textAlign="center">
              <Typography textColor="neutral600">
                Showing 20 of {queue.length} operations
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Ships Monitoring - Master Only */}
      {status?.mode === 'master' && (
        <Box background="neutral0" borderRadius="8px" shadow="filterShadow" padding={4}>
          <Box marginBottom={6}>
            <Flex gap={2} alignItems="center">
              <Typography variant="beta" fontWeight="bold">
                🚢 Connected Ships
              </Typography>
            </Flex>
          </Box>

          {ships.length === 0 ? (
            <Box padding={6} textAlign="center">
              <Typography textColor="neutral600">
                No ships registered yet. Ships will appear here when they connect.
              </Typography>
            </Box>
          ) : (
            <Table colCount={5} rowCount={ships.length + 1}>
              <Thead>
                <Tr>
                  <Th><Typography variant="sigma">Ship ID</Typography></Th>
                  <Th><Typography variant="sigma">Ship Name</Typography></Th>
                  <Th><Typography variant="sigma">Status</Typography></Th>
                  <Th><Typography variant="sigma">Last Seen</Typography></Th>
                  <Th><Typography variant="sigma">Registered</Typography></Th>
                </Tr>
              </Thead>
              <Tbody>
                {ships.map((ship) => (
                  <Tr key={ship.id}>
                    <Td>
                      <Typography
                        textColor="primary600"
                        style={{ fontFamily: 'monospace', fontWeight: 'bold' }}
                      >
                        {ship.ship_id}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">{ship.ship_name}</Typography>
                    </Td>
                    <Td>
                      <Badge
                        backgroundColor={ship.connectivity_status === 'online' ? 'success100' : 'warning100'}
                        textColor={ship.connectivity_status === 'online' ? 'success700' : 'warning700'}
                      >
                        {ship.connectivity_status === 'online' ? '🟢 ONLINE' : '🟠 OFFLINE'}
                      </Badge>
                    </Td>
                    <Td>
                      <Typography variant="pi" textColor="neutral600">
                        {formatDate(ship.last_seen_at)}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography variant="pi" textColor="neutral600">
                        {formatDate(ship.created_at)}
                      </Typography>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </Box>
      )}

      {/* Conflicts Section - Master Only */}
      {status?.mode === 'master' && conflicts.length > 0 && (
        <Box background="neutral0" borderRadius="8px" shadow="filterShadow" padding={4} marginTop={6}>
          <Flex justifyContent="space-between" alignItems="center" marginBottom={6}>
            <Flex gap={2} alignItems="center">
              <WarningIcon />
              <Typography variant="beta" fontWeight="bold" textColor="danger600">
                Conflicts ({unresolvedConflictsCount} unresolved)
              </Typography>
            </Flex>
          </Flex>

          <Table colCount={7} rowCount={conflicts.length + 1}>
            <Thead>
              <Tr>
                <Th><Typography variant="sigma">ID</Typography></Th>
                <Th><Typography variant="sigma">Content Type</Typography></Th>
                <Th><Typography variant="sigma">Content ID</Typography></Th>
                <Th><Typography variant="sigma">Ship ID</Typography></Th>
                <Th><Typography variant="sigma">Versions</Typography></Th>
                <Th><Typography variant="sigma">Status</Typography></Th>
                <Th><Typography variant="sigma">Actions</Typography></Th>
              </Tr>
            </Thead>
            <Tbody>
              {conflicts.map((conflict) => (
                <Tr key={conflict.id}>
                  <Td>
                    <Typography textColor="neutral800">#{conflict.id}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">
                      {formatContentType(conflict.content_type)}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography
                      textColor="primary600"
                      style={{ fontFamily: 'monospace', fontSize: '12px' }}
                    >
                      {conflict.content_id}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{conflict.ship_id}</Typography>
                  </Td>
                  <Td>
                    <Flex gap={1}>
                      <Badge backgroundColor="warning100" textColor="warning700">
                        Ship: v{conflict.ship_version}
                      </Badge>
                      <Badge backgroundColor="primary100" textColor="primary700">
                        Master: v{conflict.master_version}
                      </Badge>
                    </Flex>
                  </Td>
                  <Td>
                    {conflict.resolved_at ? (
                      <Badge backgroundColor="success100" textColor="success700">
                        RESOLVED ({conflict.resolution_strategy})
                      </Badge>
                    ) : (
                      <Badge backgroundColor="danger100" textColor="danger700">
                        UNRESOLVED
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    {!conflict.resolved_at && (
                      <Button
                        variant="secondary"
                        size="S"
                        onClick={() => openConflictModal(conflict)}
                      >
                        Resolve
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      )}

      {/* Conflict Resolution Modal */}
      {isConflictModalOpen && selectedConflict && (
        <Modal.Root open={isConflictModalOpen} onOpenChange={setIsConflictModalOpen}>
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>
                Resolve Conflict - {formatContentType(selectedConflict.content_type)} #{selectedConflict.content_id}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Box marginBottom={4}>
                <Typography variant="omega" textColor="neutral600">
                  This content was modified on both the ship ({selectedConflict.ship_id}) and master.
                  Choose how to resolve this conflict.
                </Typography>
              </Box>

              <Grid.Root gap={4}>
                <Grid.Item col={6} s={12}>
                  <Box background="warning100" padding={4} borderRadius="4px">
                    <Typography variant="delta" fontWeight="bold" textColor="warning700">
                      Ship Version (v{selectedConflict.ship_version})
                    </Typography>
                    <Box marginTop={2} style={{ maxHeight: '300px', overflow: 'auto' }}>
                      <pre style={{
                        fontSize: '11px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        margin: 0,
                        fontFamily: 'monospace'
                      }}>
                        {JSON.stringify(selectedConflict.ship_data, null, 2)}
                      </pre>
                    </Box>
                  </Box>
                </Grid.Item>
                <Grid.Item col={6} s={12}>
                  <Box background="primary100" padding={4} borderRadius="4px">
                    <Typography variant="delta" fontWeight="bold" textColor="primary700">
                      Master Version (v{selectedConflict.master_version})
                    </Typography>
                    <Box marginTop={2} style={{ maxHeight: '300px', overflow: 'auto' }}>
                      <pre style={{
                        fontSize: '11px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        margin: 0,
                        fontFamily: 'monospace'
                      }}>
                        {JSON.stringify(selectedConflict.master_data, null, 2)}
                      </pre>
                    </Box>
                  </Box>
                </Grid.Item>
              </Grid.Root>

              <Box marginTop={6}>
                <Field.Root>
                  <Field.Label>Resolution Strategy</Field.Label>
                  <SingleSelect
                    value={resolutionStrategy}
                    onChange={(value: string | number) => setResolutionStrategy(String(value))}
                  >
                    <SingleSelectOption value="keep-master">
                      Keep Master Version - Discard ship changes
                    </SingleSelectOption>
                    <SingleSelectOption value="keep-ship">
                      Keep Ship Version - Override master with ship data
                    </SingleSelectOption>
                  </SingleSelect>
                </Field.Root>
                <Box marginTop={2}>
                  <Typography variant="pi" textColor="neutral600">
                    {resolutionStrategy === 'keep-master'
                      ? 'The ship\'s changes will be discarded and master data will be preserved.'
                      : 'The master data will be overwritten with the ship\'s version.'}
                  </Typography>
                </Box>
              </Box>
            </Modal.Body>
            <Modal.Footer>
              <Modal.Close>
                <Button variant="tertiary">Cancel</Button>
              </Modal.Close>
              <Button
                variant="danger"
                onClick={handleResolveConflict}
                loading={resolving}
              >
                Resolve Conflict
              </Button>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      )}
    </Box>
  );
};

export default HomePage;
