import React, { useState, useEffect } from 'react';
import {
  Page, Layout, Card, ResourceList, ResourceItem, Text, Badge, Button,
  Modal, FormLayout, TextField, Select, Banner, Box
} from '@shopify/polaris';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

export default function AdminDashboard() {
  const { user, logout, changePassword } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newLimit, setNewLimit] = useState('');

  const [isResetPwdModalOpen, setIsResetPwdModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');

  const [isChangeLimitModalOpen, setIsChangeLimitModalOpen] = useState(false);
  const [limitVal, setLimitVal] = useState('');

  // Self change password (first login)
  const [forceChangePwd, setForceChangePwd] = useState(user?.force_change === 1);
  const [ownNewPwd, setOwnNewPwd] = useState('');

  useEffect(() => {
    if (!forceChangePwd) fetchUsers();
  }, [forceChangePwd]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/admin/users');
      setUsers(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async () => {
    try {
      await axios.post('/api/admin/users', { 
        username: newUsername, 
        password: newPassword, 
        daily_limit: newLimit || null 
      });
      setIsAddUserModalOpen(false);
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add user');
    }
  };

  const handleDeleteUser = async (id) => {
    if (!confirm('Are you sure you want to delete this user and all their data?')) return;
    try {
      await axios.delete(`/api/admin/users/${id}`);
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete user');
    }
  };

  const handleResetPassword = async () => {
    try {
      await axios.post(`/api/admin/users/${selectedUser}/reset-password`, { newPassword: resetPasswordVal });
      setIsResetPwdModalOpen(false);
      alert('Password reset successfully');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reset password');
    }
  };

  const handleChangeLimit = async () => {
    try {
      await axios.put(`/api/admin/users/${selectedUser}/limit`, { limit: limitVal });
      setIsChangeLimitModalOpen(false);
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to change limit');
    }
  };

  const handleForceChangePwd = async () => {
    try {
      await changePassword(ownNewPwd);
      setForceChangePwd(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to change password');
    }
  };

  const renderForceChange = () => (
    <Page title="Change Default Password">
      <Layout>
        <Layout.Section>
          <Card sectioned>
            <FormLayout>
              <Banner status="warning">You are using the default password. You must change it before continuing.</Banner>
              <TextField label="New Password" type="password" value={ownNewPwd} onChange={setOwnNewPwd} />
              <Button primary onClick={handleForceChangePwd}>Update Password</Button>
            </FormLayout>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );

  if (forceChangePwd) return renderForceChange();

  return (
    <Page
      title="Admin Dashboard"
      primaryAction={{ content: 'Add Member', onAction: () => setIsAddUserModalOpen(true) }}
      secondaryActions={[
        { content: 'View My Dashboard', onAction: () => navigate('/') },
        { content: 'Logout', onAction: logout, destructive: true } // destructive prop adds appropriate styling if possible, or just normal plain
      ]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <ResourceList
              resourceName={{ singular: 'user', plural: 'users' }}
              items={users}
              loading={loading}
              renderItem={(usr) => {
                const limitText = usr.daily_limit ? `${usr.sent_today}/${usr.daily_limit}` : `${usr.sent_today}/∞`;
                return (
                  <ResourceItem id={usr.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <Text variant="bodyMd" fontWeight="bold" as="h3">
                          {usr.username} {usr.role === 'admin' && <Badge status="info">Admin</Badge>}
                        </Text>
                        <Text variant="bodySm" tone="subdued">Stores: {usr.stores_count || 0}</Text>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <Text variant="bodyMd">Sent Today: {limitText}</Text>
                        <Text variant="bodySm" tone="subdued">Last Status: {usr.last_status || 'N/A'}</Text>
                      </div>
                      <div>
                        {usr.role !== 'admin' && (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <Button size="micro" onClick={() => { setSelectedUser(usr.id); setLimitVal(usr.daily_limit || ''); setIsChangeLimitModalOpen(true); }}>Limit</Button>
                            <Button size="micro" onClick={() => { setSelectedUser(usr.id); setIsResetPwdModalOpen(true); }}>Reset Pwd</Button>
                            <Button size="micro" destructive onClick={() => handleDeleteUser(usr.id)}>Delete</Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </ResourceItem>
                );
              }}
            />
          </Card>
        </Layout.Section>
      </Layout>

      {/* Add User Modal */}
      <Modal open={isAddUserModalOpen} onClose={() => setIsAddUserModalOpen(false)} title="Add New Member" primaryAction={{ content: 'Create', onAction: handleAddUser }}>
        <Modal.Section>
          <FormLayout>
            <TextField label="Username" value={newUsername} onChange={setNewUsername} />
            <TextField label="Initial Password" type="password" value={newPassword} onChange={setNewPassword} />
            <TextField label="Daily Limit (Leave blank for unlimited)" type="number" value={newLimit} onChange={setNewLimit} />
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* Reset Password Modal */}
      <Modal open={isResetPwdModalOpen} onClose={() => setIsResetPwdModalOpen(false)} title="Reset Member Password" primaryAction={{ content: 'Reset', onAction: handleResetPassword }}>
        <Modal.Section>
          <FormLayout>
            <TextField label="New Password" type="password" value={resetPasswordVal} onChange={setResetPasswordVal} />
            <Text tone="subdued">The user will be required to change this upon their next login.</Text>
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* Change Limit Modal */}
      <Modal open={isChangeLimitModalOpen} onClose={() => setIsChangeLimitModalOpen(false)} title="Change Daily Limit" primaryAction={{ content: 'Save', onAction: handleChangeLimit }}>
        <Modal.Section>
          <FormLayout>
            <TextField label="Daily Limit (Leave blank for unlimited)" type="number" value={limitVal} onChange={setLimitVal} />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
