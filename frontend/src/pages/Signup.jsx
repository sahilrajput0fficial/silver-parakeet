import React, { useState } from 'react';
import { Page, Layout, Card, FormLayout, TextField, Button, Text, Link, Banner, Box } from '@shopify/polaris';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const { signup } = useAuth();
  const navigate = useNavigate();

  const handleSignup = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await signup(email, password, username);
      
      if (data.success) {
        if (data.autoLogin) {
          // If verification is off, user is already logged in (backend set cookie & token)
          // The AuthContext will pick it up or we can just redirect to dashboard
          window.location.href = '/'; 
        } else {
          // Standard signup with email verification pending
          navigate('/login', { state: { message: 'Signup successful! Please login.' } });
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Signup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f6f6f7' }}>
      <Page narrowWidth>
        <Layout>
          <Layout.Section>
            <Card sectioned>
              <Box padding="4" textAlign="center">
                <Text variant="headingLg" as="h1">Create Account</Text>
                <Text color="subdued">Join the Shopify Invoice Bulk Sender</Text>
              </Box>
              
              {error && (
                <Box paddingBlockEnd="4">
                  <Banner status="critical">{error}</Banner>
                </Box>
              )}

              <FormLayout>
                <TextField label="Username" value={username} onChange={setUsername} autoComplete="username" />
                <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
                <TextField label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
                <Button primary fullWidth loading={loading} onClick={handleSignup}>Sign Up</Button>
              </FormLayout>

              <Box paddingBlockStart="4" textAlign="center">
                <Text>Already have an account? <Link onClick={() => navigate('/login')}>Login</Link></Text>
              </Box>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
